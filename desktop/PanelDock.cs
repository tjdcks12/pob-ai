using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// Lua reserves the viewport; this HWND occupies that space under PoB's shared caption.
internal sealed class PanelDock : IDisposable
{
    internal const string HostProperty = "PoBAI.DockHost.v1", WidthProperty = "PoBAI.DockWidth.v1", PaneProperty = "PoBAI.DockPane.v1";
    internal static readonly uint ReleaseMessage = RegisterWindowMessage("PoBAI.Dock.Release.v1");
    internal static readonly uint FocusMessage = RegisterWindowMessage("PoBAI.Dock.Focus.v1");
    private readonly Form panel;
    private readonly Action changed;
    private readonly Timer timer = new Timer { Interval = 80 };
    private IntPtr target, style, exStyle;
    private uint targetPid;
    private Rectangle floating;
    private Size minimum;
    private Padding padding;
    private bool clipAdded, releasing;
    // While PoB closes the pane stays hidden: F5 brings the same window back, a real close ends
    // PoB AI. A window that never returns gets the chat back as a floating window.
    private DateTime hiddenUntil;
    internal TimeSpan OwnerReturnTimeout = TimeSpan.FromSeconds(20);
    internal bool Enabled { get; private set; }
    internal bool Attached { get; private set; }
    internal int Width { get; set; }
    internal Rectangle FloatingBounds { get { return Enabled ? floating : NormalBounds(); } }

    internal PanelDock(Form panel, Action changed)
    {
        this.panel = panel;
        this.changed = changed;
        floating = NormalBounds();
        Width = panel.Width;
        timer.Tick += (s, e) => Sync();
        timer.Start();
    }

    internal void SetEnabled(bool enabled)
    {
        if (Enabled == enabled) return;
        if (enabled)
        {
            floating = NormalBounds();
            panel.WindowState = FormWindowState.Normal;
            Enabled = true;
            Sync();
        }
        else { Enabled = false; ReleaseTarget(); }
        changed();
    }

    internal void SetTarget(IntPtr handle)
    {
        if (target == handle) { Sync(); return; }
        ReleaseTarget();
        target = handle;
        targetPid = 0;
        if (target != IntPtr.Zero) GetWindowThreadProcessId(target, out targetPid);
        Sync();
    }

    private Rectangle NormalBounds() { return panel.WindowState == FormWindowState.Normal ? panel.Bounds : panel.RestoreBounds; }

    internal void Sync()
    {
        if (panel.IsDisposed || releasing) return;
        if (hiddenUntil != DateTime.MinValue && DateTime.UtcNow >= hiddenUntil) { hiddenUntil = DateTime.MinValue; panel.Show(); }
        if (!Enabled) return;
        uint pid;
        if (target == IntPtr.Zero || !IsWindow(target) || GetWindowThreadProcessId(target, out pid) == 0 || pid != targetPid
            || GetProp(target, HostProperty) == IntPtr.Zero)
        { OwnerClosing(); return; }
        if (IsIconic(target)) return;
        NativeRect client;
        if (!GetClientRect(target, out client)) return;
        int bar = GetProp(target, HostProperty).ToInt32();
        int dpi = (int)GetDpiForWindow(target);
        int minWidth = 370 * dpi / 96, minContent = 640 * dpi / 96;
        int width = Math.Min(Math.Max(minWidth, Width), client.Right - minContent);
        if (width < minWidth || client.Bottom <= bar) { ReleaseTarget(); return; }
        if (!Attached)
        {
            var other = GetProp(target, PaneProperty);
            if (other != IntPtr.Zero && other != panel.Handle && IsWindow(other)) return;
            // Mismatched awareness in cross-process SetParent can reset the child's process.
            // Main creates the panel in PoB's DPI context; never attempt an unsafe match.
            if (!AreDpiAwarenessContextsEqual(GetWindowDpiAwarenessContext(target), GetWindowDpiAwarenessContext(panel.Handle))) return;
            style = GetWindowLongPtr(panel.Handle, -16); exStyle = GetWindowLongPtr(panel.Handle, -20);
            minimum = panel.MinimumSize; padding = panel.Padding;
            panel.MinimumSize = Size.Empty;
            panel.Padding = new Padding(4, 0, 0, 0);
            SetWindowLongPtr(panel.Handle, -16, new IntPtr((style.ToInt64() & ~0x80cf0000L) | 0x40000000L));
            SetWindowLongPtr(panel.Handle, -20, new IntPtr(exStyle.ToInt64() & ~0x00040300L));
            SetParent(panel.Handle, target);
            if (GetParent(panel.Handle) != target) { RestorePanel(true); return; }
            clipAdded = (GetWindowLongPtr(target, -16).ToInt64() & 0x02000000L) == 0;
            if (clipAdded) SetWindowLongPtr(target, -16, new IntPtr(GetWindowLongPtr(target, -16).ToInt64() | 0x02000000L));
            SetProp(target, PaneProperty, panel.Handle);
            Attached = true;
            if (hiddenUntil != DateTime.MinValue) { hiddenUntil = DateTime.MinValue; panel.Show(); }
            changed();
        }
        SetProp(target, WidthProperty, new IntPtr(width));
        SetWindowPos(panel.Handle, IntPtr.Zero, client.Right - width, bar, width, client.Bottom - bar, 0x0050);
    }

    internal void ActivateOwner()
    {
        if (Enabled && target != IntPtr.Zero && IsWindow(target))
        {
            if (IsIconic(target)) ShowWindow(target, 9);
            if (Attached) SetForegroundWindow(target);
        }
        Sync();
    }

    internal void ResizeFromScreenX(int x)
    {
        if (!Attached) return;
        var point = new Point(x, 0);
        ScreenToClient(target, ref point);
        NativeRect client;
        if (GetClientRect(target, out client)) { Width = client.Right - point.X; Sync(); Width = panel.Width; }
    }

    // The Lua adapter calls this synchronously before PoB destroys its HWND.
    internal void OwnerClosing()
    {
        if (!Attached || releasing || panel.IsDisposed) return;
        panel.Hide();
        hiddenUntil = DateTime.UtcNow + OwnerReturnTimeout;
        ReleaseTarget(false);
    }

    internal void ReleaseTarget() { ReleaseTarget(true); }

    private void ReleaseTarget(bool show)
    {
        if (!Attached || releasing) return;
        releasing = true;
        if (IsWindow(target) && GetProp(target, PaneProperty) == panel.Handle)
        {
            RemoveProp(target, WidthProperty); RemoveProp(target, PaneProperty);
            if (clipAdded) SetWindowLongPtr(target, -16, new IntPtr(GetWindowLongPtr(target, -16).ToInt64() & ~0x02000000L));
        }
        Attached = false;
        if (!panel.IsDisposed && IsWindow(panel.Handle))
        {
            SetParent(panel.Handle, IntPtr.Zero);
            RestorePanel(show);
        }
        releasing = false;
        changed();
    }

    private void RestorePanel(bool show)
    {
        // The saved style carries WS_VISIBLE; a hidden pane must not get it back.
        SetWindowLongPtr(panel.Handle, -16, show ? style : new IntPtr(style.ToInt64() & ~0x10000000L)); SetWindowLongPtr(panel.Handle, -20, exStyle);
        panel.MinimumSize = minimum; panel.Padding = padding;
        SetWindowPos(panel.Handle, IntPtr.Zero, floating.X, floating.Y, floating.Width, floating.Height, show ? 0x0074u : 0x0034u);
    }

    public void Dispose() { timer.Stop(); timer.Dispose(); ReleaseTarget(); }

    [StructLayout(LayoutKind.Sequential)] private struct NativeRect { internal int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr hwnd, out NativeRect rect);
    [DllImport("user32.dll")] private static extern bool ScreenToClient(IntPtr hwnd, ref Point point);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr child);
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] private static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="GetPropW")] private static extern IntPtr GetProp(IntPtr hwnd, string name);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SetPropW")] private static extern bool SetProp(IntPtr hwnd, string name, IntPtr value);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="RemovePropW")] private static extern IntPtr RemoveProp(IntPtr hwnd, string name);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern uint RegisterWindowMessage(string name);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetWindowDpiAwarenessContext(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool AreDpiAwarenessContextsEqual(IntPtr first, IntPtr second);
}
