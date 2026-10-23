using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class Launcher
{
    private static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }

    [STAThread]
    private static void Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        try
        {
            string entry = Path.Combine(root, "launcher.mjs");
            if (!File.Exists(entry)) throw new FileNotFoundException();
            string bundled = Path.Combine(root, @"runtime\node\node.exe");
            var arguments = new StringBuilder(Quote(entry) + " --quiet");
            if (!Array.Exists(args, arg => arg == "--panel-only" || arg == "--settings")) arguments.Append(" --open");
            foreach (string arg in args) arguments.Append(" " + Quote(arg));
            Process.Start(new ProcessStartInfo(File.Exists(bundled) ? bundled : "node.exe", arguments.ToString()) {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden
            });
        }
        catch
        {
            // Only a damaged installation reaches this window. No stack trace or console.
            Application.EnableVisualStyles();
            var catalog = new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string, string[]>>(
                new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream("PoBAI.LauncherStrings")).ReadToEnd());
            string locale = CultureInfo.CurrentUICulture.Name;
            if (locale.StartsWith("zh-TW", StringComparison.OrdinalIgnoreCase) || locale.StartsWith("zh-HK", StringComparison.OrdinalIgnoreCase)
                || locale.StartsWith("zh-MO", StringComparison.OrdinalIgnoreCase) || locale.StartsWith("zh-Hant", StringComparison.OrdinalIgnoreCase)) locale = "zh-Hant";
            if (locale.StartsWith("pt", StringComparison.OrdinalIgnoreCase)) locale = "pt-BR";
            if (!catalog.ContainsKey(locale)) locale = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
            string[] text = catalog.ContainsKey(locale) ? catalog[locale] : catalog["en"];
            using (var form = new Form { Text = "PoB AI", ClientSize = new Size(440, 166), StartPosition = FormStartPosition.CenterScreen,
                FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false, Font = new Font("Segoe UI", 10) })
            {
                var message = new Label { Text = text[0], AutoSize = false, Location = new Point(22, 22), Size = new Size(396, 70) };
                var download = new Button { Text = text[1], Location = new Point(154, 112), Size = new Size(152, 32) };
                var close = new Button { Text = text[2], Location = new Point(318, 112), Size = new Size(100, 32) };
                download.Click += (sender, e) => Process.Start(new ProcessStartInfo("https://github.com/tjdcks12/pob-ai/releases/latest") { UseShellExecute = true });
                close.Click += (sender, e) => form.Close();
                form.Controls.AddRange(new Control[] { message, download, close });
                form.AcceptButton = download;
                form.CancelButton = close;
                Application.Run(form);
            }
        }
    }
}
