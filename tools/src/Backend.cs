using System;
using System.Diagnostics;
using System.IO;

namespace MangoRoyalLauncher
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.Title = "Mango Royal - Backend & Database Manager";
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string rootDir = Path.GetFullPath(Path.Combine(baseDir, ".."));
            string workDir = Path.Combine(rootDir, "mango-royal-kiosk", "mango-royal-backend");
            string dbCheckScript = Path.Combine(rootDir, "tools", "check-db.js");

            Console.WriteLine("====================================================");
            Console.WriteLine("  Mango Royal - Shared Backend & Database (Port 3000)");
            Console.WriteLine("====================================================");
            Console.WriteLine();

            // 1. Check and initialize Database
            Console.WriteLine("[Step 1/2] Verifying MySQL Database status...");
            ProcessStartInfo psiDb = new ProcessStartInfo
            {
                FileName = "node.exe",
                Arguments = string.Format("\"{0}\"", dbCheckScript),
                WorkingDirectory = workDir,
                UseShellExecute = false
            };
            psiDb.EnvironmentVariables["NODE_PATH"] = Path.Combine(workDir, "node_modules");

            try
            {
                Process procDb = Process.Start(psiDb);
                procDb.WaitForExit();
            }
            catch (Exception ex)
            {
                Console.WriteLine("Note on DB check: " + ex.Message);
            }

            Console.WriteLine();
            Console.WriteLine("[Step 2/2] Launching Backend Server (port 3000)...");

            // 2. Launch Backend server
            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = "node.exe",
                Arguments = "server.js",
                WorkingDirectory = workDir,
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
                Console.WriteLine("Press any key to exit...");
                Console.ReadKey();
            }
        }
    }
}
