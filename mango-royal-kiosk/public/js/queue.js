// js/queue.js
export function initQueue({ onDone }) {
    const screen = document.getElementById('queue-screen');
    const numEl = screen.querySelector('#queue-number');
    const cdEl = screen.querySelector('#q-countdown');
    const doneBtn = screen.querySelector('#q-done');
    const printBtn = screen.querySelector('#q-print');
    let lastOrderData = null;
    let timer = null;

    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

    doneBtn.onclick = () => { stop(); onDone(); };

    if (printBtn) {
        printBtn.onclick = () => {
            const w = window.open('', '_blank', 'width=380,height=520');
            if (!w) return window.print();
            w.document.write(`
                <html>
                <head>
                    <title>Mango Royal Receipt</title>
                    <style>
                        body { font-family: monospace; padding: 20px; font-size: 13px; text-align: center; }
                        h2 { margin: 0; font-size: 18px; }
                        p { margin: 4px 0; color: #555; }
                        .line { border-top: 1px dashed #000; margin: 12px 0; }
                        .q-num { font-size: 36px; font-weight: bold; margin: 10px 0; }
                        .text-left { text-align: left; }
                    </style>
                </head>
                <body>
                    <h2>MANGO ROYAL</h2>
                    <p>Official Order Acknowledgement</p>
                    <div class="line"></div>
                    <p>QUEUE NUMBER</p>
                    <div class="q-num">${numEl.innerText}</div>
                    <div class="line"></div>
                    <p>Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</p>
                    <p>Device: KIOSK_01</p>
                    <p>Status: PENDING PAYMENT</p>
                    <div class="line"></div>
                    <p>Please present this number to the cashier for payment and verification.</p>
                    <p>Thank you for choosing Mango Royal!</p>
                </body>
                </html>
            `);
            w.document.close();
            w.focus();
            setTimeout(() => { w.print(); w.close(); }, 300);
        };
    }

    return {
        show: ({ queueNumber }) => {
            numEl.innerText = queueNumber || '—';
            screen.classList.remove('hidden');

            let secs = 15;
            cdEl.innerText = secs;
            stop();
            timer = setInterval(() => {
                secs--;
                cdEl.innerText = secs;
                if (secs <= 0) { stop(); onDone(); }
            }, 1000);
        },
        hide: () => { stop(); screen.classList.add('hidden'); },
    };
}
