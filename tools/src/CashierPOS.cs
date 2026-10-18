using System;
using System.Diagnostics;
using System.IO;

namespace MangoRoyalLauncher
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.Title = "Mango Royal - Cashier POS";
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string rootDir = Path.GetFullPath(Path.Combine(baseDir, ".."));
            string serveScript = Path.Combine(rootDir, "tools", "serve.js");
            string targetDir = Path.Combine(rootDir, "mango-royal-pos-lite");

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = "node.exe",
                Arguments = string.Format("\"{0}\" \"{1}\" 5001 \"Cashier POS\"", serveScript, targetDir),
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
