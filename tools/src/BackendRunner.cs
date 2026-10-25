using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace MangoRoyalLauncher
{
    internal sealed class ManagedService
    {
        public string Name;
        public string Url;
        public int Port;
        public Process Process;
        public Label StatusLabel;
        public Button StartButton;
        public Button StopButton;
        public int UnmanagedPortOwnerId;
    }

    internal sealed class BackendRunner : Form
    {
        private readonly string rootDir;
        private readonly string serveScript;
        private readonly string backendDir;
        private readonly string printerDir;
        private readonly List<ManagedService> services = new List<ManagedService>();
        private readonly Button startAllButton;
        private readonly Button stopAllButton;
        private readonly RichTextBox log;
        private readonly System.Windows.Forms.Timer statusTimer;
        private readonly string pairingCode;
        private readonly object processDiscoveryLock = new object();
        private int operationActive;
        private int healthProbeActive;
        private int deviceProbeActive;
        private int processScanActive;
        private int backendWasHealthy;
        private DateTime lastDeviceProbe = DateTime.MinValue;
        private DateTime lastProcessScan = DateTime.MinValue;
        private Label pairedDevicesLabel;

        private ManagedService printerService;
        private ManagedService backendService;

        public BackendRunner()
        {
            Text = "Mango Royal - Backend Runner";
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(760, 540);
            Size = new Size(820, 650);
            Font = new Font("Segoe UI", 9F);
            BackColor = Color.FromArgb(245, 247, 250);

            rootDir = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
            serveScript = Path.Combine(rootDir, "tools", "serve.js");
            backendDir = Path.Combine(rootDir, "mango-royal-kiosk", "mango-royal-backend");
            printerDir = Path.Combine(rootDir, "mango-royal-printer-server");
            pairingCode = CreatePairingCode();

            var header = new Label
            {
                Text = "MANGO ROYAL  |  SYSTEM RUNNER",
                Dock = DockStyle.Top,
                Height = 52,
                Padding = new Padding(20, 14, 0, 0),
                BackColor = Color.FromArgb(30, 41, 59),
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 13F, FontStyle.Bold)
            };

            var content = new Panel { Dock = DockStyle.Fill, Padding = new Padding(18) };
            var intro = new Label
            {
                Text = "Start the backend stack and each app here. Start All runs them in dependency order.",
                Dock = DockStyle.Top,
                Height = 34,
                ForeColor = Color.FromArgb(71, 85, 105)
            };

            var controls = new FlowLayoutPanel
            {
                Dock = DockStyle.Top,
                Height = 48,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false
            };
            startAllButton = CreateButton("Start All", Color.FromArgb(22, 163, 74));
            stopAllButton = CreateButton("Stop All", Color.FromArgb(220, 38, 38));
            startAllButton.Click += delegate { RunOperation(StartAllCore); };
            stopAllButton.Click += delegate { RunOperation(StopAllCore); };
            controls.Controls.Add(startAllButton);
            controls.Controls.Add(stopAllButton);

            var servicesPanel = new TableLayoutPanel
            {
                Dock = DockStyle.Top,
                Height = 250,
                ColumnCount = 4,
                RowCount = 6,
                BackColor = Color.White,
                CellBorderStyle = TableLayoutPanelCellBorderStyle.Single,
                Padding = new Padding(8)
            };
            servicesPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 220));
            servicesPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            servicesPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 90));
            servicesPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 90));
            for (int i = 0; i < 6; i++) servicesPanel.RowStyles.Add(new RowStyle(SizeType.Percent, 16.66F));

            printerService = AddService(servicesPanel, "Printer Service", "http://127.0.0.1:3101");
            backendService = AddService(servicesPanel, "Backend API", "http://127.0.0.1:3000");
            AddService(servicesPanel, "Customer Kiosk", "http://localhost:5000");
            AddService(servicesPanel, "Cashier POS", "http://localhost:5001");
            AddService(servicesPanel, "Kitchen Display", "http://localhost:5002");
            AddService(servicesPanel, "Admin Dashboard", "http://localhost:5003");

            var pairingPanel = new Panel
            {
                Dock = DockStyle.Top,
                Height = 76,
                BackColor = Color.White,
                Padding = new Padding(10, 6, 10, 6)
            };
            var pairingTitle = new Label
            {
                Text = "ANDROID PAIRING CODE",
                Dock = DockStyle.Top,
                Height = 22,
                ForeColor = Color.FromArgb(71, 85, 105),
                Font = new Font("Segoe UI", 8F, FontStyle.Bold)
            };
            var pairingDetails = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                Padding = new Padding(0, 2, 0, 0)
            };
            var pairingCodeLabel = new Label
            {
                Text = pairingCode,
                Width = 115,
                Height = 34,
                ForeColor = Color.FromArgb(30, 41, 59),
                Font = new Font("Consolas", 18F, FontStyle.Bold),
                TextAlign = ContentAlignment.MiddleLeft
            };
            pairedDevicesLabel = new Label
            {
                Text = "No Android devices paired",
                Width = 440,
                Height = 34,
                ForeColor = Color.FromArgb(100, 116, 139),
                TextAlign = ContentAlignment.MiddleLeft
            };
            pairingDetails.Controls.Add(pairingCodeLabel);
            pairingDetails.Controls.Add(pairedDevicesLabel);
            pairingPanel.Controls.Add(pairingDetails);
            pairingPanel.Controls.Add(pairingTitle);

            var logTitle = new Label
            {
                Text = "Activity",
                Dock = DockStyle.Top,
                Height = 28,
                Padding = new Padding(0, 6, 0, 0),
                ForeColor = Color.FromArgb(30, 41, 59),
                Font = new Font("Segoe UI", 9F, FontStyle.Bold)
            };
            log = new RichTextBox
            {
                Dock = DockStyle.Fill,
                ReadOnly = true,
                BackColor = Color.FromArgb(15, 23, 42),
                ForeColor = Color.FromArgb(226, 232, 240),
                BorderStyle = BorderStyle.None,
                Font = new Font("Consolas", 9F)
            };

            content.Controls.Add(log);
            content.Controls.Add(logTitle);
            content.Controls.Add(pairingPanel);
            content.Controls.Add(servicesPanel);
            content.Controls.Add(controls);
            content.Controls.Add(intro);
            Controls.Add(content);
            Controls.Add(header);

            statusTimer = new System.Windows.Forms.Timer { Interval = 1000 };
            statusTimer.Tick += UpdateServiceStatuses;
            statusTimer.Start();

            Log("Ready. The backend and database must be available before frontend apps can start.");
        }

        private ManagedService AddService(TableLayoutPanel panel, string name, string url)
        {
            var service = new ManagedService
            {
                Name = name,
                Url = url,
                Port = new Uri(url).Port
            };
            int row = services.Count;
            services.Add(service);

            var nameLabel = new Label
            {
                Text = name,
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft,
                Padding = new Padding(8, 0, 0, 0),
                ForeColor = Color.FromArgb(30, 41, 59),
                Font = new Font("Segoe UI", 9F, FontStyle.Bold)
            };
            service.StatusLabel = new Label
            {
                Text = "Stopped",
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft,
                ForeColor = Color.FromArgb(100, 116, 139)
            };
            service.StartButton = CreateButton("Start", Color.FromArgb(37, 99, 235));
            service.StopButton = CreateButton("Stop", Color.FromArgb(100, 116, 139));
            service.StopButton.Enabled = false;
            service.StartButton.Click += delegate { StartSingleService(service); };
            service.StopButton.Click += delegate { StopSingleService(service); };

            panel.Controls.Add(nameLabel, 0, row);
            panel.Controls.Add(service.StatusLabel, 1, row);
            panel.Controls.Add(service.StartButton, 2, row);
            panel.Controls.Add(service.StopButton, 3, row);
            return service;
        }

        private static Button CreateButton(string text, Color color)
        {
            return new Button
            {
                Text = text,
                BackColor = color,
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                FlatAppearance = { BorderSize = 0 },
                Width = 82,
                Height = 30,
                Margin = new Padding(4, 8, 4, 4),
                Cursor = Cursors.Hand
            };
        }

        private void RunOperation(Action operation)
        {
            if (Interlocked.CompareExchange(ref operationActive, 1, 0) != 0) return;
            SetControlsEnabled(false);
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    operation();
                }
                catch (Exception ex)
                {
                    Log("ERROR: " + ex.Message);
                    ShowError(ex.Message);
                }
                finally
                {
                    Interlocked.Exchange(ref operationActive, 0);
                    SetControlsEnabled(true);
                }
            });
        }

        private void StartSingleService(ManagedService service)
        {
            RunOperation(delegate
            {
                AdoptExistingServices();
                if (service == backendService)
                {
                    StartBackendStackCore();
                    return;
                }
                if (service == printerService)
                {
                    StartPrinterCore();
                    return;
                }
                EnsureBackendHealthy();
                StartFrontendCore(service);
            });
        }

        private void StopSingleService(ManagedService service)
        {
            RunOperation(delegate
            {
                AdoptExistingServices();
                StopServiceCore(service);
            });
        }

        private void StartAllCore()
        {
            AdoptExistingServices();
            Log("Starting backend, printer, and frontend services...");
            StartBackendStackCore();
            foreach (ManagedService service in services)
            {
                if (service != backendService && service != printerService)
                    StartFrontendCore(service);
            }
            Log("All services are running.");
        }

        private void StopAllCore()
        {
            AdoptExistingServices();
            Log("Stopping frontend services and backend stack...");
            var errors = new List<string>();
            for (int i = services.Count - 1; i >= 0; i--)
            {
                try
                {
                    StopServiceCore(services[i]);
                }
                catch (Exception error)
                {
                    errors.Add(services[i].Name + ": " + error.Message);
                    Log("ERROR stopping " + services[i].Name + ": " + error.Message);
                }
            }
            try
            {
                AdoptExistingServices();
                foreach (ManagedService service in services)
                {
                    if (IsRunning(service))
                        errors.Add(service.Name + " is still running after its Stop operation.");
                }
            }
            catch (Exception error)
            {
                errors.Add("Could not verify service shutdown: " + error.Message);
            }
            if (errors.Count > 0)
                throw new InvalidOperationException("Some services could not be stopped:" + Environment.NewLine
                    + String.Join(Environment.NewLine, errors.ToArray()));
            Log("All detected Mango Royal services have been stopped and verified.");
        }

        private void StartBackendStackCore()
        {
            try
            {
                EnsureServicePortAvailable(backendService);
                StartPrinterCore();
                if (IsBackendHealthy())
                {
                    SetState(backendService, "Online");
                    Log("Backend API is already available.");
                    return;
                }

                SetState(backendService, "Checking database...");
                Log("Checking and preparing the database...");
                int checkExitCode = RunNodeAndWait(
                    Path.Combine(rootDir, "tools", "check-db.js"),
                    backendDir,
                    120000,
                    true);
                if (checkExitCode != 0)
                    throw new InvalidOperationException("The database check failed (exit code " + checkExitCode + ").");

                if (!IsRunning(backendService))
                {
                    Log("Starting backend API on port 3000...");
                    StartManagedProcess(
                        backendService,
                        backendDir,
                        "server.js",
                        false);
                }

                WaitForBackend();
                SetState(backendService, "Online");
                Log("Backend API is ready.");
            }
            catch
            {
                SetState(backendService, IsBackendHealthy()
                    ? "Online"
                    : IsRunning(backendService) ? "Unavailable" : "Stopped");
                throw;
            }
        }

        private void StartPrinterCore()
        {
            if (IsRunning(printerService))
            {
                Log("Printer service is already running.");
                return;
            }
            EnsureServicePortAvailable(printerService);
            if (IsRunning(printerService))
            {
                Log("Printer service is already running on its service port.");
                return;
            }
            Log("Starting printer service...");
            StartManagedProcess(printerService, printerDir, "server.js", false);
            SetState(printerService, "Running");
        }

        private void StartFrontendCore(ManagedService service)
        {
            if (IsRunning(service))
            {
                Log(service.Name + " is already running.");
                return;
            }
            EnsureServicePortAvailable(service);
            if (IsRunning(service))
            {
                Log(service.Name + " is already running on its service port.");
                return;
            }
            EnsureBackendHealthy();

            string targetDirectory = GetFrontendDirectory(service);
            string port = GetFrontendPort(service);
            string appName = service.Name;
            string arguments = Quote(serveScript) + " " + Quote(targetDirectory) + " " + port + " " + Quote(appName);
            Log("Starting " + service.Name + "...");
            StartManagedProcess(service, rootDir, arguments, true);
            SetState(service, "Running");
            WaitForFrontend(service);
        }

        private string GetFrontendDirectory(ManagedService service)
        {
            if (service.Name == "Customer Kiosk")
                return Path.Combine(rootDir, "mango-royal-kiosk", "public");
            if (service.Name == "Cashier POS")
                return Path.Combine(rootDir, "mango-royal-pos-lite");
            if (service.Name == "Kitchen Display")
                return Path.Combine(rootDir, "mango-royal-kitchen-lite");
            if (service.Name == "Admin Dashboard")
                return Path.Combine(rootDir, "Admin Dashboard Interface (2)");
            throw new InvalidOperationException("Unknown frontend service: " + service.Name);
        }

        private static string GetFrontendPort(ManagedService service)
        {
            if (service.Name == "Customer Kiosk") return "5000";
            if (service.Name == "Cashier POS") return "5001";
            if (service.Name == "Kitchen Display") return "5002";
            if (service.Name == "Admin Dashboard") return "5003";
            throw new InvalidOperationException("Unknown frontend service: " + service.Name);
        }

        private void EnsureBackendHealthy()
        {
            if (!IsBackendHealthy())
                throw new InvalidOperationException("Backend is unavailable. Start Backend API first; frontend apps were not started.");
        }

        private void WaitForBackend()
        {
            for (int attempt = 0; attempt < 60; attempt++)
            {
                if (backendService.Process != null && backendService.Process.HasExited)
                    throw new InvalidOperationException("Backend stopped during startup. Check the activity log for details.");
                Dictionary<int, List<int>> listeners = GetListeningProcessIds();
                List<int> ownerIds;
                if (backendService.Process != null
                    && listeners.TryGetValue(backendService.Port, out ownerIds)
                    && ownerIds.Contains(backendService.Process.Id)
                    && IsBackendHealthy())
                    return;
                Thread.Sleep(1000);
            }
            throw new TimeoutException("Backend did not become ready within 60 seconds. Check MySQL and the backend activity log.");
        }

        private void WaitForFrontend(ManagedService service)
        {
            int expectedProcessId = service.Process.Id;
            string unexpectedOwner = null;
            for (int attempt = 0; attempt < 20; attempt++)
            {
                if (!IsRunning(service))
                    throw new InvalidOperationException(service.Name + " stopped during startup. Check the activity log for details.");

                Dictionary<int, List<int>> listeners = GetListeningProcessIds();
                List<int> ownerIds;
                if (listeners.TryGetValue(service.Port, out ownerIds))
                {
                    if (!ownerIds.Contains(expectedProcessId))
                    {
                        unexpectedOwner = String.Join(", ", ownerIds.ConvertAll(id => id.ToString()).ToArray());
                        Thread.Sleep(500);
                        continue;
                    }

                    HttpWebRequest request = (HttpWebRequest)WebRequest.Create(service.Url);
                    request.Method = "GET";
                    request.Timeout = 1000;
                    request.ReadWriteTimeout = 1000;
                    request.Proxy = null;
                    try
                    {
                        if (!IsRunning(service))
                            throw new InvalidOperationException(service.Name + " stopped during startup. Check the activity log for details.");
                    using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    {
                            if ((int)response.StatusCode < 500) return;
                        }
                    }
                    catch (WebException) { }
                }
                Thread.Sleep(500);
            }
            string ownerDetails = unexpectedOwner == null
                ? String.Empty
                : " Listener PID(s) " + unexpectedOwner + " did not match the new service process PID "
                    + expectedProcessId + ".";
            throw new TimeoutException(service.Name + " did not bind to port " + service.Port
                + " within 10 seconds." + ownerDetails + " Check the activity log for a port conflict.");
        }

        private bool IsBackendHealthy()
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(backendService.Url + "/api/health");
            request.Method = "GET";
            request.Timeout = 1200;
            request.ReadWriteTimeout = 1200;
            request.Proxy = null;
            try
            {
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    return response.StatusCode == HttpStatusCode.OK;
            }
            catch (WebException)
            {
                return false;
            }
        }

        private int RunNodeAndWait(string script, string workingDirectory, int timeoutMs, bool useNodePath)
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = "node.exe",
                Arguments = Quote(script),
                WorkingDirectory = workingDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            if (useNodePath)
                startInfo.EnvironmentVariables["NODE_PATH"] = Path.Combine(backendDir, "node_modules");

            using (var process = new Process())
            {
                process.StartInfo = startInfo;
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args)
                {
                    if (!String.IsNullOrEmpty(args.Data)) Log(args.Data);
                };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args)
                {
                    if (!String.IsNullOrEmpty(args.Data)) Log(args.Data);
                };
                if (!process.Start())
                    throw new InvalidOperationException("Could not start Node.js for the database check.");
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                if (!process.WaitForExit(timeoutMs))
                {
                    process.Kill();
                    throw new TimeoutException("Database check did not finish within two minutes.");
                }
                process.WaitForExit();
                return process.ExitCode;
            }
        }

        private void StartManagedProcess(ManagedService service, string workingDirectory, string arguments, bool openBrowser)
        {
            if (!Directory.Exists(workingDirectory))
                throw new DirectoryNotFoundException("Service folder not found: " + workingDirectory);
            var startInfo = new ProcessStartInfo
            {
                FileName = "node.exe",
                Arguments = arguments,
                WorkingDirectory = workingDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            if (service == backendService)
                startInfo.EnvironmentVariables["NODE_PATH"] = Path.Combine(backendDir, "node_modules");
            if (service == backendService)
                startInfo.EnvironmentVariables["MROYAL_PAIR_CODE"] = pairingCode;
            if (service.Name == "Customer Kiosk")
                startInfo.EnvironmentVariables["LIVE_RELOAD"] = "1";

            var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args)
            {
                if (!String.IsNullOrEmpty(args.Data)) Log(args.Data);
            };
            process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args)
            {
                if (!String.IsNullOrEmpty(args.Data)) Log(args.Data);
            };
            try
            {
                if (!process.Start())
                    throw new InvalidOperationException("Could not start " + service.Name + ".");
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                service.Process = process;
                SetState(service, "Starting");
                if (openBrowser) Log("The app will open in your browser when its server is ready.");
            }
            catch
            {
                process.Dispose();
                throw;
            }
        }

        private void EnsureServicePortAvailable(ManagedService service)
        {
            Dictionary<int, List<int>> listeners = GetListeningProcessIds();
            List<int> processIds;
            if (listeners.TryGetValue(service.Port, out processIds))
            {
                foreach (int processId in processIds)
                {
                    ServiceProcessInfo info = GetServiceProcessInfo(processId);
                    if (info == null || !IsMangoRoyalProcess(service, info))
                    {
                        service.UnmanagedPortOwnerId = processId;
                        SetState(service, "Port in use (PID " + processId + ")");
                        throw new InvalidOperationException(service.Name + " cannot start because port "
                            + service.Port + " is occupied by an unrecognized process (PID "
                            + processId + "). It was left running.");
                    }

                    service.UnmanagedPortOwnerId = 0;
                    if (!IsRunning(service))
                        service.Process = Process.GetProcessById(processId);
                    SetState(service, service == backendService && IsBackendHealthy()
                        ? "Online"
                        : "Running (existing)");
                }
            }
            else
            {
                service.UnmanagedPortOwnerId = 0;
            }

            if (service.UnmanagedPortOwnerId != 0)
            {
                throw new InvalidOperationException(service.Name + " cannot start because port "
                    + service.Port + " is occupied by an unrecognized process (PID "
                    + service.UnmanagedPortOwnerId + "). It was left running.");
            }
        }

        private void AdoptExistingServices()
        {
            lock (processDiscoveryLock)
            {
                Dictionary<int, List<int>> listeners = GetListeningProcessIds();
                foreach (ManagedService service in services)
                {
                    List<int> processIds;
                    if (!listeners.TryGetValue(service.Port, out processIds))
                    {
                        service.UnmanagedPortOwnerId = 0;
                        if (!IsRunning(service)) SetState(service, "Stopped");
                        continue;
                    }

                    int unmatchedProcessId = 0;
                    bool adopted = false;
                    foreach (int processId in processIds)
                    {
                        if (unmatchedProcessId == 0) unmatchedProcessId = processId;
                        ServiceProcessInfo info = GetServiceProcessInfo(processId);
                        if (info == null) continue;
                        if (!IsMangoRoyalProcess(service, info))
                        {
                            continue;
                        }

                        if (!IsRunning(service))
                        {
                            try
                            {
                                service.Process = Process.GetProcessById(processId);
                                Log("Detected existing " + service.Name + " task (PID " + processId
                                    + ") on port " + service.Port + "; Stop controls now manage it.");
                            }
                            catch (ArgumentException)
                            {
                                continue;
                            }
                        }
                        service.UnmanagedPortOwnerId = 0;
                        SetState(service, service == backendService && IsBackendHealthy()
                            ? "Online"
                            : "Running (existing)");
                        adopted = true;
                        break;
                    }

                    if (!adopted && !IsRunning(service))
                    {
                        if (service.UnmanagedPortOwnerId != unmatchedProcessId)
                        {
                            service.UnmanagedPortOwnerId = unmatchedProcessId;
                            if (unmatchedProcessId != 0)
                                Log(service.Name + " port " + service.Port + " is occupied by an unrecognized process (PID "
                                    + unmatchedProcessId + "); it will not be stopped automatically.");
                        }
                        SetState(service, unmatchedProcessId == 0
                            ? "Stopped"
                            : "Port in use (PID " + unmatchedProcessId + ")");
                    }
                }
            }
        }

        private Dictionary<int, List<int>> GetListeningProcessIds()
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.SystemDirectory, "netstat.exe"),
                Arguments = "-ano -p tcp",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };

            using (Process netstat = Process.Start(startInfo))
            {
                if (netstat == null)
                    throw new InvalidOperationException("Could not inspect Windows TCP listeners.");
                string output = netstat.StandardOutput.ReadToEnd();
                string error = netstat.StandardError.ReadToEnd();
                if (!netstat.WaitForExit(5000))
                {
                    netstat.Kill();
                    throw new TimeoutException("Timed out while inspecting Windows TCP listeners.");
                }
                if (netstat.ExitCode != 0)
                    throw new InvalidOperationException("Could not inspect Windows TCP listeners: " + error.Trim());

                var listeners = new Dictionary<int, List<int>>();
                MatchCollection matches = Regex.Matches(
                    output,
                    @"^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$",
                    RegexOptions.IgnoreCase | RegexOptions.Multiline);
                foreach (Match match in matches)
                {
                    int port;
                    int processId;
                    if (!Int32.TryParse(match.Groups[1].Value, out port)
                        || !Int32.TryParse(match.Groups[2].Value, out processId))
                        continue;
                    List<int> processIds;
                    if (!listeners.TryGetValue(port, out processIds))
                    {
                        processIds = new List<int>();
                        listeners.Add(port, processIds);
                    }
                    if (!processIds.Contains(processId)) processIds.Add(processId);
                }
                return listeners;
            }
        }

        private static ServiceProcessInfo GetServiceProcessInfo(int processId)
        {
            string query = "SELECT Name, ExecutablePath, CommandLine, ParentProcessId FROM Win32_Process WHERE ProcessId = "
                + processId;
            using (var searcher = new ManagementObjectSearcher(query))
            using (ManagementObjectCollection results = searcher.Get())
            {
                foreach (ManagementObject item in results)
                {
                    return new ServiceProcessInfo
                    {
                        ProcessId = processId,
                        ParentProcessId = Convert.ToInt32(item["ParentProcessId"]),
                        Name = item["Name"] as string,
                        ExecutablePath = item["ExecutablePath"] as string,
                        CommandLine = item["CommandLine"] as string
                    };
                }
            }
            return null;
        }

        private bool IsMangoRoyalProcess(ManagedService service, ServiceProcessInfo info)
        {
            if (!String.Equals(info.Name, "node.exe", StringComparison.OrdinalIgnoreCase)
                || String.IsNullOrEmpty(info.CommandLine))
                return false;

            if (service != backendService && service != printerService)
            {
                return info.CommandLine.IndexOf(serveScript, StringComparison.OrdinalIgnoreCase) >= 0;
            }
            return Regex.IsMatch(
                info.CommandLine,
                @"(?:^|\s|[""'])server\.js(?:[""']|\s|$)",
                RegexOptions.IgnoreCase);
        }

        private void StopServiceProcess(ManagedService service, Process process)
        {
            if (process.HasExited) return;
            int processId = process.Id;
            ServiceProcessInfo current = GetServiceProcessInfo(processId);
            int treeRootId = FindServiceProcessTreeRoot(service, current);
            if (treeRootId == 0)
            {
                process.Kill();
                return;
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.SystemDirectory, "taskkill.exe"),
                Arguments = "/PID " + treeRootId + " /T /F",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (Process taskkill = Process.Start(startInfo))
            {
                if (taskkill == null)
                    throw new InvalidOperationException("Could not stop the existing " + service.Name + " process tree.");
                string output = taskkill.StandardOutput.ReadToEnd();
                string error = taskkill.StandardError.ReadToEnd();
                if (!taskkill.WaitForExit(5000))
                {
                    taskkill.Kill();
                    throw new TimeoutException("Timed out while stopping the " + service.Name + " process tree.");
                }
                if (taskkill.ExitCode != 0 && !process.HasExited)
                {
                    throw new InvalidOperationException("Could not stop " + service.Name + " (PID "
                        + processId + "): " + (error + " " + output).Trim());
                }
            }
        }

        private int FindServiceProcessTreeRoot(ManagedService service, ServiceProcessInfo processInfo)
        {
            ServiceProcessInfo current = processInfo;
            for (int depth = 0; current != null && current.ParentProcessId > 0 && depth < 10; depth++)
            {
                current = GetServiceProcessInfo(current.ParentProcessId);
                if (current == null
                    || !String.Equals(current.Name, "node.exe", StringComparison.OrdinalIgnoreCase)
                    || String.IsNullOrEmpty(current.CommandLine))
                    continue;

                bool isNodeWatcher = current.CommandLine.IndexOf("--watch", StringComparison.OrdinalIgnoreCase) >= 0
                    && Regex.IsMatch(current.CommandLine, @"(?:server\.js|serve\.js)", RegexOptions.IgnoreCase);
                bool isNpmLauncher = current.CommandLine.IndexOf("npm-cli.js", StringComparison.OrdinalIgnoreCase) >= 0
                    && Regex.IsMatch(current.CommandLine, @"\b(?:start|run)\b", RegexOptions.IgnoreCase);
                if (isNodeWatcher || isNpmLauncher)
                    return current.ProcessId;
            }
            return 0;
        }

        private sealed class ServiceProcessInfo
        {
            public int ProcessId;
            public int ParentProcessId;
            public string Name;
            public string ExecutablePath;
            public string CommandLine;
        }

        private void StopServiceCore(ManagedService service)
        {
            Process process = service.Process;
            if (process == null || process.HasExited)
            {
                service.Process = null;
                if (service.UnmanagedPortOwnerId != 0)
                {
                    throw new InvalidOperationException(service.Name + " uses port " + service.Port
                        + ", but its owner (PID " + service.UnmanagedPortOwnerId
                        + ") is not a recognized Mango Royal process. It was left running.");
                }
                SetState(service, "Stopped");
                return;
            }
            Log("Stopping " + service.Name + "...");
            StopServiceProcess(service, process);
            if (!process.WaitForExit(5000) && !process.HasExited)
                throw new TimeoutException(service.Name + " did not stop within five seconds.");
            process.Dispose();
            service.Process = null;
            service.UnmanagedPortOwnerId = 0;
            if (service == backendService) Interlocked.Exchange(ref backendWasHealthy, 0);
            SetState(service, "Stopped");
        }

        private static bool IsRunning(ManagedService service)
        {
            return service.Process != null && !service.Process.HasExited;
        }

        private static string CreatePairingCode()
        {
            byte[] bytes = new byte[4];
            using (RandomNumberGenerator generator = RandomNumberGenerator.Create())
            {
                generator.GetBytes(bytes);
            }
            uint value = BitConverter.ToUInt32(bytes, 0) % 1000000;
            return value.ToString("D6");
        }

        private void UpdateServiceStatuses(object sender, EventArgs e)
        {
            foreach (ManagedService service in services)
            {
                if (service.Process != null && service.Process.HasExited)
                {
                    service.Process.Dispose();
                    service.Process = null;
                    if (service == backendService) Interlocked.Exchange(ref backendWasHealthy, 0);
                    SetState(service, "Stopped");
                }
            }

            if (DateTime.UtcNow - lastProcessScan >= TimeSpan.FromSeconds(3)
                && Interlocked.CompareExchange(ref operationActive, 0, 0) == 0
                && Interlocked.CompareExchange(ref processScanActive, 1, 0) == 0)
            {
                lastProcessScan = DateTime.UtcNow;
                ThreadPool.QueueUserWorkItem(delegate
                {
                    try
                    {
                        AdoptExistingServices();
                    }
                    catch (Exception error)
                    {
                        Log("Could not inspect existing service tasks: " + error.Message);
                    }
                    finally
                    {
                        Interlocked.Exchange(ref processScanActive, 0);
                    }
                });
            }

            if (DateTime.UtcNow - lastDeviceProbe >= TimeSpan.FromSeconds(3)
                && Interlocked.CompareExchange(ref deviceProbeActive, 1, 0) == 0)
            {
                lastDeviceProbe = DateTime.UtcNow;
                ThreadPool.QueueUserWorkItem(delegate
                {
                    try
                    {
                        UpdatePairedDeviceStatus();
                    }
                    finally
                    {
                        Interlocked.Exchange(ref deviceProbeActive, 0);
                    }
                });
            }

            if (Interlocked.CompareExchange(ref operationActive, 0, 0) == 0
                && Interlocked.CompareExchange(ref healthProbeActive, 1, 0) == 0)
            {
                ThreadPool.QueueUserWorkItem(delegate
                {
                    try
                    {
                        if (IsBackendHealthy())
                        {
                        int previousState = Interlocked.Exchange(ref backendWasHealthy, 1);
                        if (previousState == 2) Log("Backend connection restored.");
                        SetState(backendService, "Online");
                    }
                    else if (IsRunning(backendService)
                        && Interlocked.CompareExchange(ref backendWasHealthy, 2, 1) == 1)
                    {
                        Log("Backend connection lost. Frontend apps will remain locked until it recovers.");
                        SetState(backendService, "Unavailable");
                    }
                    }
                    finally
                    {
                        Interlocked.Exchange(ref healthProbeActive, 0);
                    }
                });
            }
        }

        private void UpdatePairedDeviceStatus()
        {
            if (!IsBackendHealthy())
            {
                SetPairedDevicesText("Android status: backend unavailable");
                return;
            }

            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(
                backendService.Url + "/api/local-devices/status");
            request.Method = "GET";
            request.Timeout = 1500;
            request.ReadWriteTimeout = 1500;
            request.Proxy = null;
            request.Headers["X-MRoyal-Pair-Code"] = pairingCode;
            try
            {
                string responseBody;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream()))
                {
                    responseBody = reader.ReadToEnd();
                }

                MatchCollection devices = Regex.Matches(
                    responseBody,
                    "\\{\"name\":\"((?:\\\\.|[^\"\\\\])*)\",\"online\":(true|false),\"lastSeenSeconds\":(\\d+)\\}");
                if (devices.Count == 0)
                {
                    SetPairedDevicesText("No Android devices paired");
                    return;
                }

                var status = new StringBuilder();
                foreach (Match device in devices)
                {
                    if (status.Length > 0) status.Append("   |   ");
                    string name = Regex.Unescape(device.Groups[1].Value);
                    bool online = device.Groups[2].Value == "true";
                    status.Append(name);
                    status.Append(online
                        ? " — Connected"
                        : " — Offline (" + device.Groups[3].Value + "s ago)");
                }
                SetPairedDevicesText(status.ToString());
            }
            catch (WebException error)
            {
                SetPairedDevicesText("Android status unavailable: " + error.Message);
            }
        }

        private void SetPairedDevicesText(string text)
        {
            if (IsDisposed || !IsHandleCreated) return;
            try
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    pairedDevicesLabel.Text = text;
                    pairedDevicesLabel.ForeColor = text.Contains("Connected")
                        ? Color.FromArgb(22, 163, 74)
                        : Color.FromArgb(100, 116, 139);
                });
            }
            catch (InvalidOperationException) { }
        }

        private void SetState(ManagedService service, string state)
        {
            if (IsDisposed || !IsHandleCreated) return;
            try
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    service.StatusLabel.Text = state;
                    if (service == backendService && state == "Online")
                        Interlocked.Exchange(ref backendWasHealthy, 1);
                    service.StatusLabel.ForeColor = state == "Online" || state.StartsWith("Running", StringComparison.Ordinal)
                        ? Color.FromArgb(22, 163, 74)
                        : state == "Stopped"
                            ? Color.FromArgb(100, 116, 139)
                            : Color.FromArgb(217, 119, 6);
                    service.StopButton.Enabled = IsRunning(service);
                });
            }
            catch (InvalidOperationException) { }
        }

        private void SetControlsEnabled(bool enabled)
        {
            if (IsDisposed || !IsHandleCreated) return;
            try
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    startAllButton.Enabled = enabled;
                    stopAllButton.Enabled = enabled;
                    foreach (ManagedService service in services)
                    {
                        service.StartButton.Enabled = enabled;
                        service.StopButton.Enabled = enabled && IsRunning(service);
                    }
                    if (enabled) UpdateServiceStatuses(this, EventArgs.Empty);
                });
            }
            catch (InvalidOperationException) { }
        }

        private void Log(string message)
        {
            if (IsDisposed || !IsHandleCreated) return;
            try
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    log.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + message + Environment.NewLine);
                    log.SelectionStart = log.TextLength;
                    log.ScrollToCaret();
                });
            }
            catch (InvalidOperationException) { }
        }

        private void ShowError(string message)
        {
            if (IsDisposed || !IsHandleCreated) return;
            try
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    MessageBox.Show(this, message, "Mango Royal Runner", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                });
            }
            catch (InvalidOperationException) { }
        }

        private static string Quote(string value)
        {
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            statusTimer.Stop();
            base.OnFormClosing(e);
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new BackendRunner());
        }
    }
}
