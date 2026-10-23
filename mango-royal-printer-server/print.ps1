param(
    [Parameter(Mandatory = $true)]
    [string]$TextPath,
    [string]$PrinterName
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$drawingAssembly = [System.Reflection.Assembly]::LoadWithPartialName('System.Drawing')
$rendererSource = @'
using System;
using System.Drawing;
using System.Drawing.Printing;

public static class MangoRoyalPrintJob
{
    public static void Print(string text, string printerName)
    {
        string[] lines = text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        bool isKioskAcknowledgement = text.IndexOf("Your order number is", StringComparison.OrdinalIgnoreCase) >= 0;
        bool isPosAcknowledgement = text.IndexOf("ACKNOWLEDGEMENT RECEIPT", StringComparison.OrdinalIgnoreCase) >= 0;
        int posHeaderEndIndex = isPosAcknowledgement
            ? Array.FindIndex(lines, String.IsNullOrWhiteSpace)
            : -1;
        int lineIndex = 0;
        bool nextLineIsOrderNumber = false;

        using (PrintDocument document = new PrintDocument())
        {
            if (!String.IsNullOrWhiteSpace(printerName))
                document.PrinterSettings.PrinterName = printerName;
            if (!document.PrinterSettings.IsValid)
                throw new InvalidOperationException(String.IsNullOrWhiteSpace(printerName)
                    ? "No valid Windows default printer is configured."
                    : "The configured Windows printer was not found: " + printerName);

            document.DocumentName = "Mango Royal receipt";
            if (isKioskAcknowledgement)
                document.DefaultPageSettings.PaperSize = new PaperSize("Mango Royal Ticket", 315, 240);
            document.DefaultPageSettings.Margins = new Margins(10, 10, 10, 10);
            document.PrintPage += delegate(object sender, PrintPageEventArgs page)
            {
                Graphics graphics = page.Graphics;
                RectangleF bounds = page.MarginBounds;
                float y = bounds.Top;

                while (lineIndex < lines.Length)
                {
                    string line = lines[lineIndex];
                    bool orderNumber = nextLineIsOrderNumber;
                    bool orderPrompt = String.Equals(line.Trim(), "Your order number is", StringComparison.OrdinalIgnoreCase);
                    bool brand = String.Equals(line.Trim(), "MANGO ROYAL", StringComparison.OrdinalIgnoreCase);
                    bool posHeader = isPosAcknowledgement && lineIndex < posHeaderEndIndex;
                    bool posTotal = isPosAcknowledgement && line.TrimStart().StartsWith("TOTAL:", StringComparison.OrdinalIgnoreCase);

                    using (Font font = isPosAcknowledgement && posHeader
                        ? new Font("Consolas", 8, FontStyle.Bold)
                        : orderNumber
                        ? new Font("Arial", 36, FontStyle.Bold)
                        : posTotal
                            ? new Font("Consolas", 8, FontStyle.Bold)
                            : brand
                            ? new Font("Arial", 13, FontStyle.Bold)
                            : orderPrompt
                                ? new Font("Arial", 10, FontStyle.Bold)
                                : String.IsNullOrWhiteSpace(line)
                                    ? new Font("Arial", 4, FontStyle.Regular)
                                    : isPosAcknowledgement
                                        ? new Font("Consolas", 8, FontStyle.Regular)
                                        : new Font("Arial", 9, FontStyle.Regular))
                    using (SolidBrush brush = new SolidBrush(Color.Black))
                    using (StringFormat format = new StringFormat())
                    {
                        format.Alignment = isKioskAcknowledgement
                            ? StringAlignment.Center
                            : StringAlignment.Near;
                        format.LineAlignment = StringAlignment.Center;
                        float height = String.IsNullOrEmpty(line)
                            ? font.GetHeight(graphics) + 2
                            : graphics.MeasureString(line, font, (int)bounds.Width, format).Height + 2;
                        if (y + height > bounds.Bottom && y > bounds.Top)
                        {
                            page.HasMorePages = true;
                            return;
                        }
                        if (!String.IsNullOrEmpty(line))
                        {
                            RectangleF area = new RectangleF(bounds.Left, y, bounds.Width, height);
                            graphics.DrawString(line, font, brush, area, format);
                        }
                        y += height;
                    }
                    lineIndex++;
                    nextLineIsOrderNumber = orderPrompt;
                }
                page.HasMorePages = false;
            };
            document.Print();
        }
    }
}
'@
Add-Type -TypeDefinition $rendererSource -ReferencedAssemblies $drawingAssembly.Location

try {
    $text = Get-Content -LiteralPath $TextPath -Raw -Encoding UTF8
    [MangoRoyalPrintJob]::Print($text, $PrinterName)
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
