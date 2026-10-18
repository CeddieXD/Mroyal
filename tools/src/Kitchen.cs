using System;
using System.Diagnostics;
using System.IO;

namespace MangoRoyalLauncher
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.Title = "Mango Royal - Kitchen Display";
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string rootDir = Path.GetFullPath(Path.Combine(baseDir, ".."));
            string serveScript = Path.Combine(rootDir, "tools", "serve.js");
            string targetDir = Path.Combine(rootDir, "mango-royal-kitchen-lite");

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = "node.exe",
                Arguments = string.Format("\"{0}\" \"{1}\" 5002 \"Kitchen Display\"", serveScript, targetDir),
                WorkingDirectory = rootDir,
                UseShellExecute = false
            };

            try
            {
                Process proc = Process.Start(psi);
                proc.WaitForExit();
            }
            catch (Exception ex)
            {
                Console.WriteLine("Error launching Node.js: " + ex.Message);
                Console.WriteLine("Ensure Node.js is installed and in your system PATH.");
                Console.ReadKey();
            }
        }
    }
}
