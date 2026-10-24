using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// Keeps a separate panel beside PoB without reparenting either process or recreating the webview.
internal sealed class PanelDock : IDisposable
{
    private readonly Form panel;
    private readonly Action changed;
    private readonly Timer timer = new Timer { Interval = 120 };
    private IntPtr target;
    private uint targetPid;
    private Rectangle floating, lastOwner;
    private Placement originalOwner;
    private bool restoreOwner, savedOwner, hiddenByDock, disposing;
    internal bool Enabled { get; private set; }
    internal bool Attached { get; private set; }
    internal Rectangle FloatingBounds { get { return Enabled ? floating : NormalBounds(); } }

    internal PanelDock(Form panel, Action changed)
    {
        this.panel = panel;
        this.changed = changed;
        floating = NormalBounds();
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
        else
        {
            Enabled = false;
            ReleaseTarget();
            panel.WindowState = FormWindowState.Normal;
            panel.Bounds = floating;
        }
        changed();
    }

    internal void SetTarget(IntPtr handle)
    {
        if (target == handle) { Sync(); return; }
        ReleaseTarget();
        if (Enabled) panel.Bounds = floating;
        target = handle;
        targetPid = 0;
        if (target != IntPtr.Zero) GetWindowThreadProcessId(target, out targetPid);
        Sync();
    }

    private Rectangle NormalBounds()
    {
        return panel.WindowState == FormWindowState.Normal ? panel.Bounds : panel.RestoreBounds;
    }

    // Prefer the right side, then the left. A maximized/full-width PoB gets room on the right.
    internal static Rectangle PanelBounds(Rectangle owner, Rectangle area, int width)
    {
        int x = owner.Right + width <= area.Right ? owner.Right : owner.Left - width;
        return new Rectangle(x, owner.Top, width, owner.Height);
    }

    internal static Rectangle MakeRoom(Rectangle owner, Rectangle area, int width)
    {
        if ((owner.Right >= area.Left && owner.Right + width <= area.Right)
            || (owner.Left <= area.Right && owner.Left - width >= area.Left)) return owner;
        int height = Math.Min(owner.Height, area.Height);
        return new Rectangle(area.Left, Math.Max(area.Top, Math.Min(owner.Top, area.Bottom - height)), area.Width - width, height);
    }

    internal void Sync()
    {
        if (!Enabled || panel.IsDisposed) return;
        uint pid;
        if (target == IntPtr.Zero || !IsWindow(target) || GetWindowThreadProcessId(target, out pid) == 0 || pid != targetPid)
        {
            if (Attached || hiddenByDock) { ReleaseTarget(); panel.Bounds = floating; }
            return;
        }
        if (IsIconic(target) || !IsWindowVisible(target))
        {
            if (panel.Visible) { hiddenByDock = true; panel.Hide(); }
            return;
        }
        if (hiddenByDock) { hiddenByDock = false; ShowWindow(panel.Handle, 4); } // SW_SHOWNOACTIVATE
        NativeRect native;
        if (!GetWindowRect(target, out native)) return;
        var owner = native.Rectangle;
        var area = Screen.FromHandle(target).WorkingArea;
        // Keep both windows useful on narrow displays instead of shrinking PoB below 640px.
        int width = Math.Min(Math.Max(panel.MinimumSize.Width, panel.Width), area.Width - 640);
        if (width < panel.MinimumSize.Width) { ReleaseTarget(); panel.Bounds = floating; return; }
        if (!Attached)
        {
            originalOwner = new Placement { length = Marshal.SizeOf(typeof(Placement)) };
            savedOwner = GetWindowPlacement(target, ref originalOwner);
            restoreOwner = false;
            Attached = true;
            changed();
        }
        else if (owner != lastOwner) restoreOwner = false;
        var adjusted = MakeRoom(owner, area, width);
        if (adjusted != owner)
        {
            if (IsZoomed(target)) ShowWindow(target, 9); // SW_RESTORE before assigning normal bounds
            SetWindowPos(target, IntPtr.Zero, adjusted.X, adjusted.Y, adjusted.Width, adjusted.Height, 0x0014);
            if (GetWindowRect(target, out native)) owner = native.Rectangle;
            if (lastOwner.IsEmpty) restoreOwner = savedOwner;
        }
        lastOwner = owner;
        // PoB may enforce its own minimum width, or run at a higher integrity level.
        // Keep the panel on screen if Windows could not make enough room beside it.
        if (owner.Right + width > area.Right && owner.Left - width < area.Left)
        {
            ReleaseTarget();
            panel.Bounds = floating;
            return;
        }
        var bounds = PanelBounds(owner, area, width);
        if (panel.WindowState == FormWindowState.Normal && panel.Bounds != bounds)
            SetWindowPos(panel.Handle, IntPtr.Zero, bounds.X, bounds.Y, bounds.Width, bounds.Height, 0x0014); // NOZORDER | NOACTIVATE
    }

    internal void ActivateOwner()
    {
        if (Enabled && target != IntPtr.Zero && IsWindow(target) && IsIconic(target)) ShowWindow(target, 9);
        Sync();
    }

    private void ReleaseTarget()
    {
        NativeRect current;
        if (restoreOwner && target != IntPtr.Zero && IsWindow(target) && !IsIconic(target)
            && GetWindowRect(target, out current) && current.Rectangle == lastOwner)
            SetWindowPlacement(target, ref originalOwner);
        restoreOwner = false;
        lastOwner = Rectangle.Empty;
        if (hiddenByDock)
        {
            hiddenByDock = false;
            if (!disposing && !panel.IsDisposed) ShowWindow(panel.Handle, 4);
        }
        if (Attached) { Attached = false; changed(); }
    }

    public void Dispose()
    {
        disposing = true;
        timer.Stop();
        timer.Dispose();
        ReleaseTarget();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        internal int Left, Top, Right, Bottom;
        internal Rectangle Rectangle { get { return Rectangle.FromLTRB(Left, Top, Right, Bottom); } }
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Placement
    {
        internal int length, flags, showCmd;
        internal Point minPosition, maxPosition;
        internal NativeRect normalPosition;
    }
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out NativeRect rect);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] private static extern bool GetWindowPlacement(IntPtr hwnd, ref Placement placement);
    [DllImport("user32.dll")] private static extern bool SetWindowPlacement(IntPtr hwnd, ref Placement placement);
}
