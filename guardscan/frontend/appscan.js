// Global Alert Override using SweetAlert2
        window.alert = function(message) {
            Swal.fire({
                title: 'NEXGEN PATROL',
                html: message.replace(/\n/g, '<br>'), // Support newlines in messages
                icon: 'info',
                confirmButtonText: 'ตกลง',
                confirmButtonColor: '#0f172a',
                customClass: {
                    popup: 'rounded-2xl',
                    title: 'text-lg font-extrabold text-slate-800',
                    confirmButton: 'rounded-xl px-6 py-2 font-bold',
                    htmlContainer: 'text-sm text-slate-600 font-medium text-left'
                }
            });
        };

        // --- 1. CONFIGURATION & STATE ---
        const SUPABASE_URL = 'https://mvcsbylbsffgbkocehzx.supabase.co';
        const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12Y3NieWxic2ZmZ2Jrb2NlaHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzMjI2NzgsImV4cCI6MjA5MTg5ODY3OH0.pxuSq1TuaSetJZAabrSPqXy6RAXAwaI_VWZ9zf5TypI';
        
        let supabaseClient;
        let userData = null;
        let activeSite = "Show DC";
        
        let localRounds = [];
        let localCheckpoints = [];
        let completedCheckpoints = {}; // { roundIndex_cpCode: true }

        let currentRound = null;
        let currentRoundIndex = null;
        let currentCheckpoint = null;
        
        let cameraStream = null;
        
        // 3-Photos State
        let capturedPhotos = [null, null, null]; // [base64_1, base64_2, base64_3]
        let activeSlotIndex = 0;

        // QR Code Reader State
        let isScanningActive = false;
        let isQrVerified = false;
        let lastScannedCode = "";
        let lastScanTime = 0;

        // Initialize Supabase Client
        if (typeof supabase !== 'undefined') {
            supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        }

        // Parse query parameters for NFC Method 1 (URL Redirection)
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const nfcCp = urlParams.get('checkpoint');
            if (nfcCp) {
                localStorage.setItem('nfc_target_checkpoint', nfcCp.trim());
                // Clean URL query params without reloading to prevent rescan on page refresh
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        } catch (e) {
            console.error("Error parsing NFC URL parameter:", e);
        }

        // Live Header Date
        function updateLiveDate() {
            try {
                const now = new Date();
                
                // Safe date update
                const liveDateEl = document.getElementById('liveDate');
                if (liveDateEl) {
                    let dateStr = "";
                    try {
                        const options = { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' };
                        dateStr = now.toLocaleDateString('th-TH', options);
                    } catch (e) {
                        try {
                            dateStr = now.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
                        } catch (e2) {
                            dateStr = now.toDateString();
                        }
                    }
                    liveDateEl.innerText = dateStr;
                }

                // Render current time
                const systemTimeEl = document.getElementById('system-time-display');
                if (systemTimeEl) {
                    const hourStr = String(now.getHours()).padStart(2, '0');
                    const minStr = String(now.getMinutes()).padStart(2, '0');
                    systemTimeEl.innerText = `${hourStr}:${minStr} น.`;
                }
            } catch (err) {
                console.error("Error in updateLiveDate:", err);
            }
        }

        // --- 1.1 QR CODE DECODER LOOP & HANDLERS ---
        function updateQrVerificationUI() {
            const badge = document.getElementById('qr-verification-badge');
            if (!badge) return;

            if (isQrVerified) {
                badge.className = "px-2.5 py-1 rounded-full text-[9px] font-extrabold bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center";
                badge.innerHTML = `<i class="fas fa-check-circle mr-1"></i> สแกนป้ายสำเร็จ`;
            } else {
                badge.className = "px-2.5 py-1 rounded-full text-[9px] font-extrabold bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center";
                badge.innerHTML = `<i class="fas fa-qrcode mr-1 animate-pulse"></i> รอสแกนป้าย...`;
            }
        }

        function scanQrCodeLoop() {
            if (!isScanningActive || !cameraStream || isQrVerified) return;

            const video = document.getElementById('camera-stream');
            if (video && video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
                const canvas = document.getElementById('capture-canvas');
                const ctx = canvas.getContext('2d');
                
                // Scale down the frame for faster QR decoding
                let width = video.videoWidth;
                let height = video.videoHeight;
                const maxDim = 640;
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(video, 0, 0, width, height);
                
                const imageData = ctx.getImageData(0, 0, width, height);
                if (typeof jsQR !== 'undefined') {
                    const code = jsQR(imageData.data, imageData.width, imageData.height, {
                        inversionAttempts: "dontInvert",
                    });
                    
                    if (code) {
                        console.log("Found QR code:", code.data);
                        handleDecodedQrCode(code.data);
                    }
                } else {
                    console.warn("jsQR library is not loaded.");
                }
            }
            
            if (isScanningActive && !isQrVerified) {
                requestAnimationFrame(scanQrCodeLoop);
            }
        }

        function handleDecodedQrCode(scannedText) {
            const now = Date.now();
            // Debounce scanning the same code too quickly
            if (scannedText === lastScannedCode && now - lastScanTime < 3000) {
                return;
            }
            
            lastScannedCode = scannedText;
            lastScanTime = now;

            console.log("Decoded QR Text:", scannedText);
            
            // Check if it matches the current checkpoint's code
            if (currentCheckpoint && scannedText.trim().toLowerCase() === currentCheckpoint.code.trim().toLowerCase()) {
                isQrVerified = true;
                isScanningActive = false; // Stop scanning further QR frames
                
                // Hide the laser line visually
                const laser = document.getElementById('scanner-laser');
                if (laser) {
                    laser.classList.add('hidden');
                }
                
                playBeepSound();
                updateQrVerificationUI();
                
                alert(`🎯 สแกนป้ายจุดตรวจสำเร็จ!\n- รหัสป้าย: ${scannedText}\n- จุดตรวจ: ${currentCheckpoint.name}\n\nกรุณาถ่ายภาพประกอบการตรวจให้ครบ 3 รูปเพื่อบันทึกงานค่ะ`);
            } else {
                // Check if it belongs to another checkpoint
                const foundCheckpoint = localCheckpoints.find(cp => cp.code.trim().toLowerCase() === scannedText.trim().toLowerCase());
                if (foundCheckpoint) {
                    alert(`⚠️ รหัสป้ายไม่ถูกต้อง!\n- ป้ายที่สแกน: "${foundCheckpoint.name}" (${scannedText})\n- จุดตรวจที่เลือก: "${currentCheckpoint.name}"\n\nกรุณาสแกนป้ายให้ตรงกับจุดตรวจที่เลือกค่ะ หรือย้อนกลับไปเลือกจุดตรวจให้ตรงกับป้ายนี้`);
                } else {
                    alert(`❌ ไม่พบรหัสป้ายนี้ในระบบ!\n- ป้ายที่สแกน: "${scannedText}"\n- จุดตรวจที่เลือก: "${currentCheckpoint.name}"`);
                }
            }
        }

        // Process any pending NFC checkpoint from URL redirections
        function processPendingNfcCheckpoint() {
            try {
                const targetCpCode = localStorage.getItem('nfc_target_checkpoint');
                if (!targetCpCode) return;

                // Ensure user is logged in and site data is available
                if (!userData || !activeSite) {
                    return;
                }

                if (!localCheckpoints || localCheckpoints.length === 0) {
                    return;
                }

                // Find the checkpoint with the matching code
                const checkpoint = localCheckpoints.find(cp => cp.code.trim().toLowerCase() === targetCpCode.trim().toLowerCase());
                if (!checkpoint) {
                    console.warn(`NFC checkpoint ${targetCpCode} not found in site ${activeSite}`);
                    localStorage.removeItem('nfc_target_checkpoint');
                    return;
                }

                // Determine active round based on current time
                let roundToSelect = currentRound;
                if (!roundToSelect) {
                    const thaiTimeStr = getBangkokTimeStr();
                    const [nowH, nowM] = thaiTimeStr.split(':').map(Number);
                    const nowMs = nowH * 60 + nowM;
                    
                    const matchingRound = localRounds.find(r => {
                        if (!r.start || !r.end) return false;
                        const [startH, startM] = r.start.split(':').map(Number);
                        const [endH, endM] = r.end.split(':').map(Number);
                        const startMs = startH * 60 + startM;
                        const endMs = endH * 60 + endM;
                        return nowMs >= startMs && nowMs <= endMs;
                    });

                    if (matchingRound) {
                        roundToSelect = matchingRound;
                        const roundIndex = localRounds.findIndex(r => r.name === matchingRound.name);
                        selectRound(matchingRound, roundIndex);
                    } else if (localRounds.length > 0) {
                        // Fallback to first round if none are currently running
                        roundToSelect = localRounds[0];
                        selectRound(localRounds[0], 0);
                    }
                }

                if (!roundToSelect) {
                    alert(`ไม่พบรอบการตรวจสำหรับจุดตรวจนี้`);
                    localStorage.removeItem('nfc_target_checkpoint');
                    return;
                }

                // Directly select the checkpoint with autoVerify = true, bypassing QR scanner and NFC popups
                proceedToSelectCheckpoint(checkpoint, true);

                // Instantly bypass QR Code scan
                isQrVerified = true;
                isScanningActive = false;
                
                stopCameraStream();

                const laser = document.getElementById('scanner-laser');
                if (laser) {
                    laser.classList.add('hidden');
                }

                updateQrVerificationUI();
                playBeepSound();

                Swal.fire({
                    toast: true,
                    position: 'top',
                    icon: 'success',
                    title: 'แตะสแกน NFC สำเร็จ!',
                    text: 'กรุณาถ่ายรูปการตรวจให้ครบ 3 รูป',
                    showConfirmButton: false,
                    timer: 3000
                });

                localStorage.removeItem('nfc_target_checkpoint');
            } catch (e) {
                console.error("Error in processPendingNfcCheckpoint:", e);
                localStorage.removeItem('nfc_target_checkpoint');
            }
        }

        // Helper to match site names flexibly (e.g. "ศูนย์ฝึก" should match "ศูนย์ฝึก I.T.C")
        function isSiteMatch(dbSite, userSite) {
            if (!dbSite || !userSite) return false;
            const s1 = dbSite.trim().toLowerCase();
            const s2 = userSite.trim().toLowerCase();
            return s1 === s2 || s1.includes(s2) || s2.includes(s1);
        }

        // Helper to get current time in Bangkok in HH:MM format
        function getBangkokTimeStr() {
            try {
                const now = new Date();
                let hour = now.getHours();
                let minute = now.getMinutes();
                try {
                    // Try to get Thailand time specifically
                    const options = { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false };
                    const parts = new Intl.DateTimeFormat('en-GB', options).formatToParts(now);
                    const hPart = parts.find(p => p.type === 'hour');
                    const mPart = parts.find(p => p.type === 'minute');
                    if (hPart && mPart) {
                        hour = parseInt(hPart.value, 10);
                        minute = parseInt(mPart.value, 10);
                    }
                } catch (e) {
                    console.warn("Intl Asia/Bangkok timeZone not supported, falling back to local time", e);
                }
                return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
            } catch (err) {
                console.error("Error in getBangkokTimeStr:", err);
                const now = new Date();
                return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            }
        }

        // Check if round's time has passed (เลยเวลาตรวจ)
        function isRoundExpired(round) {
            try {
                if (!round || !round.end) return false;
                const thaiTimeStr = getBangkokTimeStr();
                return thaiTimeStr > round.end;
            } catch (err) {
                console.error("Error in isRoundExpired:", err);
                return false;
            }
        }

        // Check if round's time has not started yet (ยังไม่ถึงรอบตรวจ)
        function isRoundNotStarted(round) {
            try {
                if (!round || !round.start) return false;
                const thaiTimeStr = getBangkokTimeStr();
                return thaiTimeStr < round.start;
            } catch (err) {
                console.error("Error in isRoundNotStarted:", err);
                return false;
            }
        }

        let activeRoundsTracker = {};

        // Web Audio API custom notification chime
        function playNotificationSound() {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                
                // First tone (Ding - D5)
                const osc1 = ctx.createOscillator();
                const gain1 = ctx.createGain();
                osc1.type = 'sine';
                osc1.frequency.setValueAtTime(587.33, ctx.currentTime);
                gain1.gain.setValueAtTime(0.0, ctx.currentTime);
                gain1.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.05);
                gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
                osc1.connect(gain1);
                gain1.connect(ctx.destination);
                osc1.start();
                osc1.stop(ctx.currentTime + 0.5);
                
                // Second tone (Dong - A5) - delayed by 150ms
                const osc2 = ctx.createOscillator();
                const gain2 = ctx.createGain();
                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
                gain2.gain.setValueAtTime(0.0, ctx.currentTime + 0.15);
                gain2.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.2);
                gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
                osc2.connect(gain2);
                gain2.connect(ctx.destination);
                osc2.start();
                osc2.stop(ctx.currentTime + 0.8);
            } catch (e) {
                console.error("Audio chime failed:", e);
            }
        }

        // Periodic checker for round time transitions (still not started -> active)
        function checkRoundTimeTransitions() {
            if (!localRounds || localRounds.length === 0) return;
            
            let needsReRender = false;
            localRounds.forEach((round, index) => {
                const isNotStarted = isRoundNotStarted(round);
                const isExpired = isRoundExpired(round);
                const isActive = !isNotStarted && !isExpired;
                
                // If round state transitioned from false (not started) to true (active)
                if (activeRoundsTracker[index] === false && isActive) {
                    playNotificationSound();
                    setTimeout(() => {
                        alert(`🔔 ถึงเวลาเข้าตรวจรอบใหม่แล้วค่ะ!\n- รอบการตรวจ: ${round.name}\n- ช่วงเวลา: ${round.start} - ${round.end} น.\n\nขณะนี้ระบบเปิดให้เข้าสแกนและบันทึกเวลาของรอบนี้ได้แล้วค่ะ`);
                    }, 50);
                    needsReRender = true;
                }
                
                // Update tracking state
                activeRoundsTracker[index] = isActive;
            });
            
            if (needsReRender) {
                renderRoundsList();
                // If user is currently looking at this round's checkpoints, refresh them too
                if (currentRound && currentRoundIndex !== null) {
                    currentRound = localRounds[currentRoundIndex];
                    renderCheckpointsList();
                }
            }
        }

        // --- 2. AUTHENTICATION & SESSION LOADING ---
        function loadUserSession() {
            const sessionStr = localStorage.getItem('nextgen_user');
            if (sessionStr && sessionStr !== 'undefined' && sessionStr !== 'null') {
                try {
                    userData = JSON.parse(sessionStr);
                    if (userData && typeof userData === 'object' && userData.level && userData.level.toLowerCase() === 'guard') {
                        const guardName = userData.name || 'พนักงาน';
                        const guardRole = userData.role || userData.level || 'รปภ.';
                        activeSite = userData.unit || userData.unit_name || 'Show DC';
                        
                        document.getElementById('guardNameLabel').innerText = `👨‍✈️ ${guardName} (${guardRole})`;
                        document.getElementById('unitNameLabel').innerText = `🏢 ${activeSite}`;
                        
                        // Hide login screen
                        document.getElementById('screen-login').classList.add('hidden');
                        
                        // Show bottom navigation bar
                        onLoginSuccess();
                        
                        // Load completed status logs from localStorage
                        try {
                            const savedCompleted = localStorage.getItem('patrol_completed_checkpoints');
                            if (savedCompleted) {
                                completedCheckpoints = JSON.parse(savedCompleted);
                            }
                        } catch (e) {
                            console.error("Error parsing completed checkpoints:", e);
                        }
                        
                        fetchRoundsAndCheckpoints();
                        return;
                    }
                } catch (e) {
                    console.error("Error parsing user session:", e);
                }
            }
            
            // If we reach here, we are not logged in as a guard.
            // Check LIFF auto login first (for future LINE OA support)
            checkLiffAutoLogin();
        }

        async function checkLiffAutoLogin() {
            try {
                if (typeof liff !== 'undefined' && liff.isLoggedIn()) {
                    const profile = await liff.getProfile();
                    const lineUserId = profile.userId;
                    
                    if (lineUserId && supabaseClient) {
                        console.log("LINE User ID found, trying auto-login:", lineUserId);
                        const { data, error } = await supabaseClient
                            .from('staff')
                            .select('*')
                            .eq('line_user_id', lineUserId)
                            .eq('status', 'เปิด')
                            .single();
                            
                        if (!error && data && data.level && data.level.toLowerCase() === 'guard') {
                            localStorage.setItem('nextgen_user', JSON.stringify(data));
                            userData = data;
                            activeSite = data.unit || 'Show DC';
                            
                            document.getElementById('guardNameLabel').innerText = `👨‍✈️ ${data.name} (${data.role || 'รปภ.'})`;
                            document.getElementById('unitNameLabel').innerText = `🏢 ${activeSite}`;
                            
                            document.getElementById('screen-login').classList.add('hidden');
                            
                            // Show bottom navigation bar
                            onLoginSuccess();
                            
                            // Load completed status logs
                            try {
                                const savedCompleted = localStorage.getItem('patrol_completed_checkpoints');
                                if (savedCompleted) {
                                    completedCheckpoints = JSON.parse(savedCompleted);
                                }
                            } catch (e) {}

                            fetchRoundsAndCheckpoints();
                            return;
                        }
                    }
                }
            } catch (err) {
                console.warn("LIFF auto-login failed:", err);
            }

            // Fallback: Show Login Screen
            document.getElementById('screen-login').classList.remove('hidden');
        }

        async function handleLoginSubmit() {
            const usernameInput = document.getElementById('login-username').value.trim();
            const passwordInput = document.getElementById('login-password').value;
            const errorMsgEl = document.getElementById('login-error-msg');
            const btnSubmit = document.getElementById('btn-login-submit');

            if (!usernameInput || !passwordInput) {
                alert("กรุณากรอกรหัสพนักงานและรหัสผ่านให้ครบถ้วน");
                return;
            }

            btnSubmit.disabled = true;
            btnSubmit.innerHTML = `<i class="fas fa-circle-notch animate-spin"></i> กำลังตรวจสอบ...`;
            errorMsgEl.classList.add('hidden');

            try {
                let loginSuccess = false;
                let userObj = null;

                // 1. Try Supabase Client
                if (supabaseClient) {
                    const { data, error } = await supabaseClient
                        .from('staff')
                        .select('*')
                        .eq('emp_id', usernameInput)
                        .eq('password', passwordInput)
                        .eq('status', 'เปิด')
                        .single();

                    if (!error && data) {
                        if (data.level && data.level.toLowerCase() === 'guard') {
                            loginSuccess = true;
                            userObj = data;
                        } else {
                            alert("❌ ไม่อนุญาตให้เข้าใช้งาน: ระบบนี้จำกัดการเข้าถึงเฉพาะระดับพนักงาน รปภ. (Guard) เท่านั้น");
                            btnSubmit.disabled = false;
                            btnSubmit.innerHTML = `<i class="fas fa-sign-in-alt"></i> เข้าสู่ระบบตรวจการ`;
                            return;
                        }
                    }
                }

                // 2. Offline / Mock fallback for testing (e.g. 5908064g / 5908)
                if (!loginSuccess) {
                    if (usernameInput === '5908064g' && passwordInput === '5908') {
                        loginSuccess = true;
                        userObj = {
                            emp_id: '5908064g',
                            name: 'นายพรชัย อ่อนคำ',
                            unit: 'ศูนย์ฝึก I.T.C',
                            role: 'หน.ชุด',
                            level: 'Guard',
                            status: 'เปิด'
                        };
                    }
                }

                if (loginSuccess && userObj) {
                    localStorage.setItem('nextgen_user', JSON.stringify(userObj));
                    userData = userObj;
                    activeSite = userObj.unit || 'Show DC';
                    
                    document.getElementById('guardNameLabel').innerText = `👨‍✈️ ${userObj.name} (${userObj.role || 'รปภ.'})`;
                    document.getElementById('unitNameLabel').innerText = `🏢 ${activeSite}`;
                    
                    // Hide login screen
                    document.getElementById('screen-login').classList.add('hidden');
                    
                    // Show bottom navigation bar
                    onLoginSuccess();
                    
                    // Clear inputs
                    document.getElementById('login-username').value = '';
                    document.getElementById('login-password').value = '';
                    
                    fetchRoundsAndCheckpoints();
                } else {
                    errorMsgEl.classList.remove('hidden');
                }
            } catch (err) {
                console.error("Login submission error:", err);
                alert("เกิดข้อผิดพลาดในการเข้าสู่ระบบ โปรดตรวจสอบสัญญาณอินเทอร์เน็ต");
            } finally {
                btnSubmit.disabled = false;
                btnSubmit.innerHTML = `<i class="fas fa-sign-in-alt"></i> เข้าสู่ระบบตรวจการ`;
            }
        }

        function handleLogout() {
            Swal.fire({
                title: 'NEXGEN PATROL',
                text: "ต้องการออกจากระบบใช่หรือไม่?",
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#e3342f',
                cancelButtonColor: '#94a3b8',
                confirmButtonText: 'ออกจากระบบ',
                cancelButtonText: 'ยกเลิก',
                customClass: {
                    popup: 'rounded-2xl',
                    title: 'text-lg font-extrabold text-slate-800',
                    confirmButton: 'rounded-xl px-6 py-2 font-bold',
                    cancelButton: 'rounded-xl px-6 py-2 font-bold text-slate-800 bg-slate-200'
                }
            }).then((result) => {
                if (result.isConfirmed) {
                    localStorage.removeItem('nextgen_user');
                    userData = null;
                    document.getElementById('screen-login').classList.remove('hidden');
                    document.getElementById('guardNameLabel').innerText = '👨‍✈️ กำลังโหลดข้อมูล...';
                    document.getElementById('unitNameLabel').innerText = '🏢 Show DC';
                    
                    // Hide bottom navigation bar
                    const navBar = document.getElementById('app-nav-bar');
                    if (navBar) {
                        navBar.classList.add('hidden');
                    }
                    
                    document.getElementById('rounds-list-container').innerHTML = `
                        <div class="p-4 bg-white rounded-2xl border border-slate-200 text-center py-8">
                            <i class="fas fa-circle-notch animate-spin text-slate-400 text-xl mb-2"></i>
                            <p class="text-xs text-slate-500 font-medium">กำลังโหลดรอบการตรวจ...</p>
                        </div>
                    `;
                }
            });
        }

        // Helper to get date in Bangkok time zone (YYYY-MM-DD) - Forced Gregorian Year
        function getBangkokTodayDateStr(dateObj = new Date()) {
            if (typeof dateObj === 'string') dateObj = new Date(dateObj);
            try {
                const options = { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' };
                // Use 'en-US-u-ca-gregory' locale to guarantee Gregorian year output regardless of device settings
                const formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory', options);
                const parts = formatter.formatToParts(dateObj);
                const day = parts.find(p => p.type === 'day').value;
                const month = parts.find(p => p.type === 'month').value;
                let year = parseInt(parts.find(p => p.type === 'year').value, 10);
                if (year > 2400) year -= 543;
                return `${year}-${month}-${day}`;
            } catch (e) {
                let year = dateObj.getFullYear();
                if (year > 2400) year -= 543;
                const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                const day = String(dateObj.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            }
        }

        // Daily reset for completed checkpoints status
        function checkAndResetDailyProgress() {
            const todayStr = getBangkokTodayDateStr();
            const savedDate = localStorage.getItem('patrol_completed_checkpoints_date');
            
            if (savedDate !== todayStr) {
                completedCheckpoints = {};
                localStorage.setItem('patrol_completed_checkpoints', JSON.stringify(completedCheckpoints));
                localStorage.setItem('patrol_completed_checkpoints_date', todayStr);
                console.log("New day detected. Resetting completed checkpoints progress.");
            }
        }


        async function fetchRoundsAndCheckpoints() {
            try {
                // Check and reset daily progress if the day has changed
                checkAndResetDailyProgress();

                let fetchedRounds = [];
                let fetchedCheckpoints = [];

                if (supabaseClient) {
                    // 1. Fetch rounds from Supabase
                    const { data: dbRounds, error: roundsError } = await supabaseClient
                        .from('patrol_rounds')
                        .select('*')
                        .order('start_time', { ascending: true });
                    
                    if (!roundsError && dbRounds) {
                        fetchedRounds = dbRounds.map(r => ({
                            id: r.id,
                            name: r.name,
                            start: r.start_time,
                            end: r.end_time,
                            siteName: r.site_name,
                            status: r.status
                        }));
                        // Update cache
                        localStorage.setItem('patrol_rounds', JSON.stringify(fetchedRounds));
                    } else if (roundsError) {
                        console.error("Supabase rounds fetch error:", roundsError);
                    }

                    // 2. Fetch checkpoints from Supabase
                    const { data: dbCheckpoints, error: checkpointsError } = await supabaseClient
                        .from('patrol_checkpoints')
                        .select('*');

                    if (!checkpointsError && dbCheckpoints) {
                        fetchedCheckpoints = dbCheckpoints.map(cp => ({
                            code: cp.code,
                            siteName: cp.site_name,
                            name: cp.name,
                            gps: cp.gps
                        }));
                        // Update cache
                        localStorage.setItem('patrol_checkpoints', JSON.stringify(fetchedCheckpoints));
                    } else if (checkpointsError) {
                        console.error("Supabase checkpoints fetch error:", checkpointsError);
                    }
                }

                // If Supabase fetch failed or returned empty (offline or error), load from localStorage fallback
                if (fetchedRounds.length === 0) {
                    const lsRounds = localStorage.getItem('patrol_rounds');
                    if (lsRounds) {
                        fetchedRounds = JSON.parse(lsRounds);
                    }
                }
                if (fetchedCheckpoints.length === 0) {
                    const lsCheckpoints = localStorage.getItem('patrol_checkpoints');
                    if (lsCheckpoints) {
                        fetchedCheckpoints = JSON.parse(lsCheckpoints);
                    }
                }

                // If still empty, use hardcoded defaults
                if (fetchedRounds.length === 0) {
                    fetchedRounds = [
                        { name: 'รอบเช้าตรู่ (รอบที่ 1)', start: '06:00', end: '08:00', siteName: activeSite, status: 'ใช้งานอยู่' },
                        { name: 'รอบกะเช้า (รอบที่ 1)', start: '08:00', end: '10:00', siteName: activeSite, status: 'ใช้งานอยู่' },
                        { name: 'รอบกะเช้า (รอบที่ 2)', start: '12:00', end: '14:00', siteName: activeSite, status: 'ใช้งานอยู่' },
                        { name: 'รอบกะบ่าย (รอบที่ 1)', start: '15:00', end: '17:00', siteName: activeSite, status: 'ใช้งานอยู่' },
                        { name: 'รอบกะดึก (รอบที่ 1)', start: '20:00', end: '22:00', siteName: activeSite, status: 'ใช้งานอยู่' }
                    ];
                }
                if (fetchedCheckpoints.length === 0) {
                    fetchedCheckpoints = [
                        { code: 'NFC-SDC_01', siteName: activeSite, name: 'ลานจอดรถ VIP ชั้น 1', gps: '13.7512, 100.5733' },
                        { code: 'QR-SDC_02', siteName: activeSite, name: 'ห้องควบคุมไฟหลัก MDB', gps: '13.7514, 100.5735' },
                        { code: 'NFC-SDC_03', siteName: activeSite, name: 'ประตูโหลดสินค้าด้านหลัง', gps: '13.7511, 100.5730' },
                        { code: 'QR-SDC_04', siteName: activeSite, name: 'คลังสินค้าหลัก Zone A', gps: '13.7515, 100.5740' }
                    ];
                }

                // Filter for current active site
                localRounds = fetchedRounds.filter(r => isSiteMatch(r.siteName, activeSite));
                let fallbackUsed = false;
                let fallbackSite = '';

                if (localRounds.length === 0) {
                    const availableRounds = fetchedRounds.filter(r => r.siteName === 'ศูนย์ฝึก I.T.C' || r.siteName === 'Show DC');
                    if (availableRounds.length > 0) {
                        fallbackUsed = true;
                        fallbackSite = availableRounds[0].siteName;
                        localRounds = availableRounds.filter(r => r.siteName === fallbackSite);
                    }
                }

                localCheckpoints = fetchedCheckpoints.filter(cp => isSiteMatch(cp.siteName, activeSite));
                if (localCheckpoints.length === 0) {
                    if (fallbackUsed) {
                        localCheckpoints = fetchedCheckpoints.filter(cp => cp.siteName === fallbackSite);
                    } else {
                        const availableCheckpoints = fetchedCheckpoints.filter(cp => cp.siteName === 'ศูนย์ฝึก I.T.C' || cp.siteName === 'Show DC');
                        if (availableCheckpoints.length > 0) {
                            fallbackUsed = true;
                            fallbackSite = availableCheckpoints[0].siteName;
                            localCheckpoints = availableCheckpoints.filter(cp => cp.siteName === fallbackSite);
                        }
                    }
                }

                // If a fallback was used, update the activeSite and UI so the guard scans at the real site
                if (fallbackUsed && fallbackSite && fallbackSite !== activeSite) {
                    activeSite = fallbackSite;
                    if (userData) {
                        userData.unit_name = activeSite;
                        localStorage.setItem('nextgen_user', JSON.stringify(userData));
                    }
                    const unitNameEl = document.getElementById('unitNameLabel');
                    if (unitNameEl) {
                        unitNameEl.innerText = `🏢 ${activeSite}`;
                    }
                }

                // Sync completed checkpoints from database patrol_logs for today and activeSite
                if (supabaseClient) {
                    const todayDateStr = getBangkokTodayDateStr();
                    const startOfDay = `${todayDateStr}T00:00:00+07:00`;
                    const endOfDay = `${todayDateStr}T23:59:59+07:00`;

                    try {
                        const { data: dbLogs, error: logsError } = await supabaseClient
                            .from('patrol_logs')
                            .select('round_name, checkpoint_code')
                            .eq('unit_name', activeSite)
                            .gte('timestamp', startOfDay)
                            .lte('timestamp', endOfDay);

                        if (!logsError && dbLogs) {
                            completedCheckpoints = {};
                            dbLogs.forEach(log => {
                                const roundIndex = localRounds.findIndex(r => r.name === log.round_name);
                                if (roundIndex !== -1) {
                                    completedCheckpoints[`${roundIndex}_${log.checkpoint_code}`] = true;
                                }
                            });
                            localStorage.setItem('patrol_completed_checkpoints', JSON.stringify(completedCheckpoints));
                            localStorage.setItem('patrol_completed_checkpoints_date', todayDateStr);
                        }
                    } catch (syncErr) {
                        console.error("Error syncing patrol logs from Supabase:", syncErr);
                    }
                }

                renderRoundsList();

                // If user is currently looking at this round's checkpoints, refresh them too
                if (currentRound && currentRoundIndex !== null) {
                    const updatedRound = localRounds[currentRoundIndex];
                    if (updatedRound) {
                        currentRound = updatedRound;
                    }
                    renderCheckpointsList();
                }

                // Process pending NFC checkpoint scan if any
                processPendingNfcCheckpoint();

            } catch (e) {
                console.error("Fetch error in fetchRoundsAndCheckpoints:", e);
            }
        }

        // --- 4. RENDER MODULES ---
        function renderRoundsList() {
            const container = document.getElementById('rounds-list-container');
            container.innerHTML = '';

            localRounds.forEach((round, index) => {
                // Calculate completion metrics
                const roundCPs = localCheckpoints;
                let completedCount = 0;
                roundCPs.forEach(cp => {
                    if (completedCheckpoints[`${index}_${cp.code}`]) {
                        completedCount++;
                    }
                });

                const totalCP = roundCPs.length;
                const progressPercent = totalCP > 0 ? Math.round((completedCount / totalCP) * 100) : 0;
                const expired = isRoundExpired(round);
                const notStarted = isRoundNotStarted(round);
                
                // Initialize tracking state on first render
                if (activeRoundsTracker[index] === undefined) {
                    activeRoundsTracker[index] = !notStarted && !expired;
                }
                
                const card = document.createElement('div');
                
                // Color configuration based on status
                let stateColor = "slate";
                let stateText = "กำลังตรวจ";
                let leftBorderColor = "border-l-slate-400";
                let badgeClass = "bg-slate-50 text-slate-600 border border-slate-200";
                let iconClass = "fa-clock text-slate-400";
                let cardOpacity = "opacity-100";
                
                // Find missing checkpoints for this round
                const missingCPs = [];
                if (expired && progressPercent < 100) {
                    roundCPs.forEach(cp => {
                        if (!completedCheckpoints[`${index}_${cp.code}`]) {
                            missingCPs.push(cp.name);
                        }
                    });
                }

                if (notStarted) {
                    stateColor = "amber";
                    stateText = "ยังไม่ถึงรอบตรวจ";
                    leftBorderColor = "border-l-amber-400";
                    badgeClass = "bg-amber-50/80 text-amber-600 border border-amber-100";
                    iconClass = "fa-hourglass-start text-amber-400";
                    cardOpacity = "opacity-80";
                } else if (expired) {
                    if (progressPercent === 100) {
                        stateColor = "emerald";
                        stateText = "ตรวจครบแล้ว";
                        leftBorderColor = "border-l-emerald-500";
                        badgeClass = "bg-emerald-50 text-emerald-600 border border-emerald-100";
                        iconClass = "fa-circle-check text-emerald-500";
                    } else {
                        stateColor = "red";
                        stateText = "ตรวจไม่ครบ";
                        leftBorderColor = "border-l-red-500";
                        badgeClass = "bg-red-50 text-red-700 border border-red-100";
                        iconClass = "fa-triangle-exclamation text-red-500";
                    }
                    cardOpacity = "opacity-80";
                } else if (progressPercent === 100) {
                    stateColor = "emerald";
                    stateText = "เสร็จสิ้น";
                    leftBorderColor = "border-l-emerald-500";
                    badgeClass = "bg-emerald-50 text-emerald-600 border border-emerald-100";
                    iconClass = "fa-circle-check text-emerald-500";
                    cardOpacity = "opacity-100";
                } else {
                    // Active (กำลังตรวจ)
                    stateColor = "sky";
                    stateText = "กำลังตรวจ";
                    leftBorderColor = "border-l-sky-500";
                    badgeClass = "bg-sky-50 text-sky-600 border border-sky-100";
                    iconClass = "fa-route text-sky-500";
                    cardOpacity = "opacity-100";
                }

                // Construct card classes - using standard Tailwind v3 padding (p-4)
                card.className = `app-card p-4 border-l-4 ${leftBorderColor} ${cardOpacity} transition-all duration-200 hover:shadow-md`;
                if (!expired && !notStarted) {
                    card.classList.add("app-card-interactive");
                }

                card.onclick = () => {
                    if (notStarted) {
                        alert(`🕒 ยังไม่ถึงเวลาตรวจรอบนี้ (เริ่มเวลา ${round.start} น.)\nไม่สามารถเข้าทำการสแกนลาดตระเวนได้ค่ะ`);
                        return;
                    }
                    if (expired) {
                        alert(`🕒 รอบเวลาตรวจนี้หมดเวลาลงแล้วเมื่อ ${round.end} น.\nไม่สามารถเข้าทำการสแกนลาดตระเวนย้อนหลังได้ค่ะ`);
                        return;
                    }
                    selectRound(round, index);
                };
                
                let missingHtml = '';
                if (expired && progressPercent < 100 && missingCPs.length > 0) {
                    missingHtml = `
                        <div class="mt-2.5 p-2 bg-red-50/70 border border-red-100 rounded-xl text-[9.5px] text-red-750 leading-relaxed font-semibold">
                            <span class="font-extrabold text-red-800 block mb-0.5"><i class="fas fa-triangle-exclamation mr-1"></i>จุดที่ไม่ได้ตรวจ (${missingCPs.length} จุด):</span>
                            ${missingCPs.join(', ')}
                        </div>
                    `;
                }

                card.innerHTML = `
                    <div class="flex justify-between items-start gap-3">
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-1.5 mb-1.5">
                                <span class="w-1.5 h-1.5 rounded-full ${
                                    stateColor === 'sky' ? 'bg-sky-500 animate-pulse' : (stateColor === 'emerald' ? 'bg-emerald-500' : (stateColor === 'amber' ? 'bg-amber-400' : 'bg-red-400'))
                                } flex-shrink-0"></span>
                                <h3 class="text-slate-900 font-extrabold text-xs break-words leading-tight">${round.name}</h3>
                            </div>
                            <div class="flex items-center gap-1 text-slate-500 text-[10.5px] font-semibold">
                                <i class="far fa-clock text-slate-400"></i>
                                <span>ช่วงเวลาตรวจ: <strong class="text-slate-700 font-bold">${round.start} - ${round.end} น.</strong></span>
                            </div>
                        </div>
                        <div class="flex-shrink-0">
                            <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold flex items-center gap-1 ${badgeClass}">
                                <i class="fas ${iconClass} text-[9px]"></i>
                                ${stateText}
                            </span>
                        </div>
                    </div>

                    <!-- Progress Section -->
                    <div class="mt-4 pt-3 border-t border-slate-100">
                        <div class="flex justify-between items-center text-[9px] font-bold mb-1.5 gap-1">
                            <span class="text-slate-400 truncate">ความคืบหน้าจุดสแกน</span>
                            <span class="${progressPercent === 100 ? 'text-emerald-600' : 'text-slate-500'} flex-shrink-0">
                                ตรวจแล้ว ${completedCount} / ${totalCP} จุด (${progressPercent}%)
                            </span>
                        </div>
                        <div class="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
                            <div class="h-full rounded-full transition-all duration-500 ${
                                expired ? (progressPercent === 100 ? 'bg-emerald-500' : 'bg-red-400') : (progressPercent === 100 ? 'bg-emerald-500' : 'bg-sky-500')
                            }" style="width: ${progressPercent}%"></div>
                        </div>
                        ${missingHtml}
                    </div>
                `;
                container.appendChild(card);
            });
        }

        function renderCheckpointsList() {
            const container = document.getElementById('checkpoints-list-container');
            container.innerHTML = '';

            const isExpired = isRoundExpired(currentRound);
            const isNotStarted = isRoundNotStarted(currentRound);

            if (isNotStarted) {
                alert(`🕒 ยังไม่ถึงเวลาตรวจรอบนี้ (เริ่มเวลา ${currentRound.start} น.)`);
                showScreen('rounds');
                return;
            }

            if (isExpired) {
                alert(`🕒 รอบเวลาตรวจนี้หมดเวลาลงแล้วเมื่อ ${currentRound.end} น.\nระบบจะนำคุณกลับไปที่หน้ารอบตรวจหลักค่ะ`);
                showScreen('rounds');
                return;
            }

            let completedCount = 0;
            localCheckpoints.forEach((cp, cpIndex) => {
                const isCompleted = completedCheckpoints[`${currentRoundIndex}_${cp.code}`];
                if (isCompleted) completedCount++;

                const card = document.createElement('div');
                
                // Add styling based on status and round duration
                if (isCompleted) {
                    card.className = "app-card app-card-interactive p-4 flex justify-between items-center bg-white border-slate-200";
                } else if (isExpired || isNotStarted) {
                    card.className = "app-card app-card-disabled p-4 flex justify-between items-center";
                } else {
                    card.className = "app-card app-card-interactive p-4 flex justify-between items-center";
                }

                card.onclick = () => {
                    if (isCompleted) {
                        alert("📍 จุดตรวจนี้ได้รับการสแกนและบันทึกรายงานเรียบร้อยแล้วในรอบนี้ ไม่สามารถกดสแกนซ้ำได้ค่ะ");
                        return;
                    }
                    if (isNotStarted) {
                        alert(`🕒 ยังไม่ถึงเวลาตรวจรอบนี้ (เริ่มเวลา ${currentRound.start} น.)\nไม่สามารถเข้าทำการสแกนลาดตระเวนได้ค่ะ`);
                        return;
                    }
                    if (isExpired) {
                        alert(`🕒 รอบเวลาตรวจนี้หมดเวลาลงแล้วเมื่อ ${currentRound.end} น.\nไม่สามารถเข้าทำการสแกนลาดตระเวนย้อนหลังได้ค่ะ`);
                        return;
                    }
                    selectCheckpoint(cp);
                };

                let rightStatusHtml = '';
                if (isCompleted) {
                    rightStatusHtml = `<span class="text-[9.5px] font-extrabold text-emerald-600"><i class="fas fa-circle-check mr-0.5"></i> ตรวจแล้ว</span>`;
                } else if (isNotStarted) {
                    rightStatusHtml = `<span class="text-[9.5px] font-extrabold text-amber-600"><i class="fas fa-clock mr-0.5"></i> ยังไม่ถึงรอบ</span>`;
                } else if (isExpired) {
                    rightStatusHtml = `<span class="text-[9.5px] font-extrabold text-red-500"><i class="fas fa-lock mr-0.5"></i> เลยเวลาตรวจ</span>`;
                } else {
                    rightStatusHtml = `<span class="text-[9.5px] font-extrabold text-slate-500">แตะเพื่อสแกน <i class="fas fa-chevron-right text-[8px] ml-0.5 text-slate-350"></i></span>`;
                }

                card.innerHTML = `
                    <div class="flex items-center gap-3 min-w-0 flex-1 mr-2">
                        <div class="w-8.5 h-8.5 rounded-full flex-shrink-0 flex items-center justify-center ${isCompleted ? 'bg-emerald-50 text-emerald-500 border border-emerald-100' : (isExpired ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 text-slate-500 border border-slate-200')}">
                            <i class="fas ${isCompleted ? 'fa-check text-[11px]' : (isExpired ? 'fa-lock text-xs' : 'fa-qrcode text-xs')}"></i>
                        </div>
                        <div class="min-w-0 flex-1">
                            <h4 class="text-slate-900 text-xs font-bold leading-tight mb-0.5 break-words">${cp.name}</h4>
                            <span class="text-slate-400 font-mono text-[9px] block truncate">รหัสป้าย: ${cp.code}</span>
                        </div>
                    </div>
                    <div class="flex-shrink-0 text-right">
                        ${rightStatusHtml}
                    </div>
                `;
                container.appendChild(card);
            });

            document.getElementById('selected-round-desc').innerText = `จุดตรวจทั้งหมด: ${localCheckpoints.length} จุด | ตรวจแล้ว: ${completedCount} จุด`;

            // Display or hide banners at the top
            const expiredBanner = document.getElementById('round-expired-banner');
            const notStartedBanner = document.getElementById('round-not-started-banner');
            
            if (isExpired) {
                if (expiredBanner) expiredBanner.classList.remove('hidden');
                if (notStartedBanner) notStartedBanner.classList.add('hidden');
            } else if (isNotStarted) {
                if (expiredBanner) expiredBanner.classList.add('hidden');
                if (notStartedBanner) notStartedBanner.classList.remove('hidden');
            } else {
                if (expiredBanner) expiredBanner.classList.add('hidden');
                if (notStartedBanner) notStartedBanner.classList.add('hidden');
            }
        }

        // --- 5. NAVIGATION ---
        function showScreen(screenId) {
            document.getElementById('screen-rounds').classList.add('hidden');
            document.getElementById('screen-checkpoints').classList.add('hidden');
            document.getElementById('screen-scanner').classList.add('hidden');
            const screenHistoryEl = document.getElementById('screen-history');
            if (screenHistoryEl) {
                screenHistoryEl.classList.add('hidden');
            }

            document.getElementById(`screen-${screenId}`).classList.remove('hidden');

            if (screenId !== 'scanner') {
                stopCameraStream();
            }
            
            updateNavBarActiveState(screenId);
        }

        function selectRound(round, index) {
            currentRound = round;
            currentRoundIndex = index;
            document.getElementById('selected-round-title').innerText = round.name;
            renderCheckpointsList();
            showScreen('checkpoints');
        }

        function selectCheckpoint(checkpoint) {
            if (currentRound) {
                if (isRoundNotStarted(currentRound)) {
                    alert(`🕒 ยังไม่ถึงเวลาตรวจของรอบนี้ (เริ่มเวลา ${currentRound.start} น.)`);
                    return;
                }
                if (isRoundExpired(currentRound)) {
                    alert(`🕒 เลยเวลาตรวจของรอบนี้แล้ว (สิ้นสุดเวลา ${currentRound.end} น.)`);
                    return;
                }
            }

            // If it's an NFC checkpoint and clicked manually in the app menu
            if (checkpoint.code.toLowerCase().startsWith('nfc')) {
                Swal.fire({
                    title: 'จุดตรวจระบบ NFC',
                    html: `จุดตรวจนี้กำหนดเป็นระบบ <b>NFC</b><br><br>` +
                          `• <b>วิธีที่แนะนำ:</b> นำโทรศัพท์ไปแตะทาบที่เหรียญ NFC ณ จุดตรวจโดยตรงได้เลยค่ะ (ไม่ต้องเปิดเมนูกล้องในแอปไว้)<br>` +
                          `• <b>วิธีสำรอง:</b> หากมีรหัส QR Code สำรองอยู่บนเหรียญ สามารถกดเปิดกล้องเพื่อสแกน QR ได้ค่ะ`,
                    icon: 'info',
                    showCancelButton: true,
                    confirmButtonText: 'เปิดกล้องสแกน QR สำรอง',
                    cancelButtonText: 'ย้อนกลับ (ไปแตะ NFC)',
                    confirmButtonColor: '#0f172a',
                    cancelButtonColor: '#64748b',
                    customClass: {
                        popup: 'rounded-2xl',
                        title: 'text-sm font-extrabold text-slate-800',
                        confirmButton: 'rounded-xl text-[10.5px] px-4 py-2.5 font-bold',
                        cancelButton: 'rounded-xl text-[10.5px] px-4 py-2.5 font-bold',
                        htmlContainer: 'text-[11px] text-slate-650 font-medium text-left leading-relaxed'
                    }
                }).then((result) => {
                    if (result.isConfirmed) {
                        proceedToSelectCheckpoint(checkpoint, false);
                    }
                });
                return;
            }

            proceedToSelectCheckpoint(checkpoint, false);
        }

        function proceedToSelectCheckpoint(checkpoint, autoVerify = false) {
            currentCheckpoint = checkpoint;
            document.getElementById('selected-checkpoint-title').innerText = checkpoint.name;
            document.getElementById('selected-checkpoint-code').innerText = `ID: ${checkpoint.code} | พิกัด GPS: ${checkpoint.gps}`;
            
            // Clear captures, note, and QR verification status
            capturedPhotos = [null, null, null];
            activeSlotIndex = 0;
            isQrVerified = autoVerify;
            
            // Show/hide the laser line based on verification status
            const laser = document.getElementById('scanner-laser');
            if (laser) {
                if (autoVerify) {
                    laser.classList.add('hidden');
                } else {
                    laser.classList.remove('hidden');
                }
            }

            updatePhotoSlotsUI();
            updateQrVerificationUI();
            
            document.getElementById('scan-note-input').value = "ตรวจเดินลาดตระเวนปกติ";
            
            showScreen('scanner');
            if (autoVerify) {
                stopCameraStream();
            } else {
                startCameraStream();
            }
        }

        // --- 6. 3-PHOTOS SLOTS SYSTEM ---
        function selectPhotoSlot(index) {
            activeSlotIndex = index;
            updatePhotoSlotsUI();
        }

        function updatePhotoSlotsUI() {
            for (let i = 0; i < 3; i++) {
                const slotDiv = document.getElementById(`photo-slot-${i}`);
                
                // Clear active styling
                slotDiv.className = "photo-slot";
                if (i === activeSlotIndex) {
                    slotDiv.classList.add('active');
                }

                const photoData = capturedPhotos[i];
                if (photoData) {
                    slotDiv.innerHTML = `
                        <img src="${photoData}" alt="Photo ${i+1}">
                        <button onclick="deletePhoto(${i}, event)" class="photo-delete-btn">
                            <i class="fas fa-times"></i>
                        </button>
                    `;
                } else {
                    slotDiv.innerHTML = `
                        <i class="fas fa-plus text-slate-400 text-[11px] mb-1"></i>
                        <span class="text-[8px] text-slate-400 font-bold">รูปที่ ${i+1}</span>
                    `;
                }
            }

            // Update photo count badge
            let takenCount = 0;
            capturedPhotos.forEach(p => { if (p) takenCount++; });
            document.getElementById('photo-count-label').innerText = `ถ่ายแล้ว ${takenCount}/3 รูป`;
        }

        function deletePhoto(index, event) {
            if (event) event.stopPropagation(); // prevent triggering selectPhotoSlot
            capturedPhotos[index] = null;
            activeSlotIndex = index; // switch back to this slot to allow retaking
            updatePhotoSlotsUI();
        }

        // Capture photo for the current active empty slot
        function capturePhotoForActiveSlot() {
            const video = document.getElementById('camera-stream');
            const canvas = document.getElementById('capture-canvas');

            playShutterSound();

            let base64Image = "";
            if (cameraStream) {
                const ctx = canvas.getContext('2d');
                canvas.width = video.videoWidth || 640;
                canvas.height = video.videoHeight || 480;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                base64Image = canvas.toDataURL('image/jpeg');
            } else {
                // Mock image for browser testing
                base64Image = "https://mvcsbylbsffgbkocehzx.supabase.co/storage/v1/object/public/profile/default-avatar.png";
            }

            // Save to active slot
            capturedPhotos[activeSlotIndex] = base64Image;
            
            // Advance activeSlotIndex to the next empty slot
            let nextEmpty = -1;
            for (let i = 0; i < 3; i++) {
                if (!capturedPhotos[i]) {
                    nextEmpty = i;
                    break;
                }
            }

            if (nextEmpty !== -1) {
                activeSlotIndex = nextEmpty;
            }

            updatePhotoSlotsUI();
        }

        // --- 7. CAMERA API CONNECTIONS ---
        async function startCameraStream() {
            const video = document.getElementById('camera-stream');
            const fallbackLabel = document.getElementById('camera-fallback-label');
            fallbackLabel.classList.add('hidden');

            // Set scanning laser line visibility depending on whether QR is verified
            const laser = document.getElementById('scanner-laser');
            if (laser) {
                if (isQrVerified) {
                    laser.classList.add('hidden');
                } else {
                    laser.classList.remove('hidden');
                }
            }

            try {
                if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                    cameraStream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: "environment" },
                        audio: false
                    });
                    video.srcObject = cameraStream;
                    video.muted = true;
                    video.classList.remove('hidden');
                    
                    try {
                        await video.play();
                    } catch (playErr) {
                        console.warn("video.play() failed, trying again...", playErr);
                    }
                    
                    // Activate QR Scanning Loop if not verified yet
                    if (!isQrVerified) {
                        isScanningActive = true;
                        requestAnimationFrame(scanQrCodeLoop);
                    } else {
                        isScanningActive = false;
                    }
                } else {
                    throw new Error("No mediaDevices support");
                }
            } catch (err) {
                console.warn("Camera fallback active:", err);
                video.classList.add('hidden');
                fallbackLabel.classList.remove('hidden');
            }
        }

        function stopCameraStream() {
            isScanningActive = false; // Stop scanning loop
            if (cameraStream) {
                cameraStream.getTracks().forEach(track => track.stop());
                cameraStream = null;
            }
            const video = document.getElementById('camera-stream');
            video.srcObject = null;
        }

        function playShutterSound() {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(300, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(1000, ctx.currentTime + 0.15);
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.15);
            } catch (e) {}
        }

        function playBeepSound() {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1200, ctx.currentTime);
                gain.gain.setValueAtTime(0.08, ctx.currentTime);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.15);
            } catch (e) { }
        }

        // Helper to convert base64 DataURL to Blob
        function dataURLtoBlob(dataurl) {
            try {
                const arr = dataurl.split(',');
                const mime = arr[0].match(/:(.*?);/)[1];
                const bstr = atob(arr[1]);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) {
                    u8arr[n] = bstr.charCodeAt(n);
                }
                return new Blob([u8arr], { type: mime });
            } catch (e) {
                console.error("dataURLtoBlob conversion failed:", e);
                return null;
            }
        }

        // Helper to upload base64 photo to Supabase storage public bucket 'patrol'
        async function uploadBase64PhotoToSupabase(base64Data, filename) {
            if (!base64Data) return null;
            try {
                const blob = dataURLtoBlob(base64Data);
                if (!blob) return null;
                const file = new File([blob], filename, { type: "image/jpeg" });
                
                if (supabaseClient) {
                    const { data, error } = await supabaseClient.storage
                        .from('patrol')
                        .upload(filename, file);
                        
                    if (error) {
                        console.error("Storage upload error:", error);
                        return null;
                    }
                    
                    const { data: urlData } = supabaseClient.storage
                        .from('patrol')
                        .getPublicUrl(filename);
                        
                    return urlData.publicUrl;
                }
                return null;
            } catch (err) {
                console.error("uploadBase64PhotoToSupabase exception:", err);
                return null;
            }
        }

        // --- 8. SAVE PATROL LOG TO SUPABASE ---
        async function saveCheckpointRecord() {
            const noteInput = document.getElementById('scan-note-input').value;
            const btnSave = document.getElementById('btn-save-record');

            // Ensure round is active (not expired and has started)
            if (currentRound) {
                if (isRoundNotStarted(currentRound)) {
                    alert(`🕒 ไม่สามารถบันทึกเวลาได้ เนื่องจากยังไม่ถึงเวลาตรวจของรอบนี้ (เริ่มเวลา ${currentRound.start} น.)`);
                    return;
                }
                if (isRoundExpired(currentRound)) {
                    alert(`🕒 ไม่สามารถบันทึกเวลาได้ เนื่องจากเลยเวลาตรวจของรอบนี้แล้ว (สิ้นสุดเวลา ${currentRound.end} น.)`);
                    return;
                }
            }

            // Ensure QR Code/NFC is verified
            if (!isQrVerified) {
                alert(`🚨 โปรดสแกนป้าย QR Code/NFC ประจำจุดตรวจนี้ให้ผ่านก่อนค่ะ จึงจะสามารถกดบันทึกรายงานการตรวจได้`);
                return;
            }

            // Ensure 3 photos taken
            let photosTakenCount = 0;
            capturedPhotos.forEach(p => { if (p) photosTakenCount++; });
            
            if (photosTakenCount < 3) {
                alert(`🚨 โปรดถ่ายรูปประกอบการตรวจให้ครบทั้ง 3 รูปค่ะ! (ขณะนี้เพิ่งถ่ายได้ ${photosTakenCount}/3 รูป)`);
                return;
            }

            btnSave.disabled = true;
            btnSave.innerHTML = `<i class="fas fa-circle-notch animate-spin"></i> กำลังเตรียมอัปโหลดรูปภาพ...`;

            let myGps = currentCheckpoint.gps || "13.7512,100.5733";
            try {
                const pos = await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
                });
                myGps = `${pos.coords.latitude},${pos.coords.longitude}`;
            } catch (gpsErr) {
                console.warn("Using checkpoint fallback coordinates.");
            }

            const thaiNow = getThaiISOString();
            const guardEmpId = userData ? userData.emp_id : "TEST_G001";

            try {
                // 1. Upload captured photos to Supabase Storage
                let uploadedUrls = [];
                for (let i = 0; i < 3; i++) {
                    btnSave.innerHTML = `<i class="fas fa-circle-notch animate-spin"></i> กำลังอัปโหลดรูปภาพ ${i + 1}/3...`;
                    const timestampMs = Date.now();
                    const cleanCode = currentCheckpoint.code.replace(/[^a-zA-Z0-9_-]/g, '');
                    const filename = `${guardEmpId}_${cleanCode}_${timestampMs}_${i + 1}.jpg`;
                    const publicUrl = await uploadBase64PhotoToSupabase(capturedPhotos[i], filename);
                    
                    if (!publicUrl) {
                        alert(`❌ อัปโหลดรูปภาพที่ ${i + 1} ล้มเหลว!\nการบันทึกถูกยกเลิก โปรดติดต่อแอดมิน (Admin) ให้ดำเนินการสร้างสิทธิ์ความปลอดภัย RLS (Storage Policies) บนถังเก็บข้อมูล 'patrol' ในระบบ Supabase ก่อนค่ะ`);
                        btnSave.disabled = false;
                        btnSave.innerHTML = `<i class="fas fa-circle-check"></i> บันทึกรายงานการตรวจ (SAVE)`;
                        return;
                    }
                    uploadedUrls.push(publicUrl);
                }

                btnSave.innerHTML = `<i class="fas fa-circle-notch animate-spin"></i> กำลังบันทึกรายงานสายตรวจ...`;

                // 2. Save to the new public.patrol_logs table
                if (supabaseClient) {
                    const { error: patrolError } = await supabaseClient
                        .from('patrol_logs')
                        .insert([{
                            guard_emp_id: guardEmpId,
                            guard_name: userData ? userData.name : "พนักงานทดสอบ",
                            role: userData ? userData.level || userData.role : "guard",
                            unit_name: activeSite,
                            round_name: currentRound.name,
                            checkpoint_code: currentCheckpoint.code,
                            checkpoint_name: currentCheckpoint.name,
                            gps_location: myGps,
                            timestamp: thaiNow,
                            note: noteInput,
                            photo_url_1: uploadedUrls[0] || null,
                            photo_url_2: uploadedUrls[1] || null,
                            photo_url_3: uploadedUrls[2] || null
                        }]);

                    if (patrolError) {
                        console.error("Supabase patrol_logs insert error:", patrolError);
                    }
                }

                // 3. Save to duty_logs table for backward compatibility with general system logs
                if (supabaseClient) {
                    const { error: dutyError } = await supabaseClient
                        .from('duty_logs')
                        .insert([{
                            emp_id: guardEmpId,
                            name: userData ? userData.name : "พนักงานทดสอบ",
                            role: userData ? userData.level || userData.role : "guard",
                            unit_name: activeSite,
                            action_type: 'patrol',
                            gps_location: myGps,
                            timestamp: thaiNow,
                            note: `[รอบ: ${currentRound.name}] จุด: ${currentCheckpoint.name} | ${noteInput} (บันทึกภาพตรวจ 3 ภาพ)`
                        }]);

                    if (dutyError) {
                        console.error("Supabase duty_logs insert error:", dutyError);
                    }
                }

                // Update checked status in memory & localStorage
                completedCheckpoints[`${currentRoundIndex}_${currentCheckpoint.code}`] = true;
                localStorage.setItem('patrol_completed_checkpoints', JSON.stringify(completedCheckpoints));
                localStorage.setItem('patrol_completed_checkpoints_date', getBangkokTodayDateStr());

                // Save to local patrol reports cache
                const lsReportsStr = localStorage.getItem('patrol_reports') || '[]';
                let lsReports = JSON.parse(lsReportsStr);
                lsReports.unshift({
                    time: thaiNow,
                    guardCode: guardEmpId,
                    siteName: activeSite,
                    checkpointCode: currentCheckpoint.code,
                    status: `ตรวจเสร็จสิ้น (${currentRound.name})`
                });
                // Cap to keep only the latest 100 items to prevent local device performance degradation
                if (lsReports.length > 100) {
                    lsReports = lsReports.slice(0, 100);
                }
                localStorage.setItem('patrol_reports', JSON.stringify(lsReports));

                playBeepSound();

                alert(`💾 บันทึกความปลอดภัยสำเร็จ!\n- จุดตรวจ: ${currentCheckpoint.name}\n- อัปโหลดรูปภาพครบ: 3 รูป\n\nข้อมูลและรูปถ่ายส่งขึ้นระบบเรียบร้อยแล้วค่ะ`);
                
                // Return to checkpoints screen
                renderCheckpointsList();
                renderRoundsList();
                showScreen('checkpoints');

            } catch (err) {
                console.error("Save failed:", err);
                alert("❌ การบันทึกข้อมูลล้มเหลว โปรดตรวจสอบสัญญาณเครือข่ายอินเทอร์เน็ต");
            } finally {
                btnSave.disabled = false;
                btnSave.innerHTML = `<i class="fas fa-circle-check"></i> บันทึกรายงานการตรวจ (SAVE)`;
            }
        }

        // Helper date string
        function getThaiISOString() {
            const now = new Date();
            const tzOffset = 7 * 60 * 60 * 1000;
            const localTime = new Date(now.getTime() + tzOffset);
            return localTime.toISOString().split('.')[0].slice(0, 19) + '+07:00';
        }

        // --- 10. APP NAVIGATION & HISTORY LOGS ---
        let activeTab = 'patrol';
        let lastPatrolScreen = 'rounds';
        let historyScope = 'me';
        let historyStartPicker = null;
        let historyEndPicker = null;

        function onLoginSuccess() {
            const navBar = document.getElementById('app-nav-bar');
            if (navBar) {
                navBar.classList.remove('hidden');
                updateNavBarActiveState('rounds');
            }
            activeTab = 'patrol';
            lastPatrolScreen = 'rounds';
        }

        function initHistoryFlatpickr() {
            // Define Flatpickr Thai locale inline to prevent CDN block issues (ERR_BLOCKED_BY_ORB)
            if (typeof flatpickr !== 'undefined' && (!flatpickr.l10ns || !flatpickr.l10ns.th)) {
                if (!flatpickr.l10ns) flatpickr.l10ns = {};
                flatpickr.l10ns.th = {
                    weekdays: {
                        shorthand: ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."],
                        longhand: ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"]
                    },
                    months: {
                        shorthand: ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."],
                        longhand: ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
                    },
                    firstDayOfWeek: 1,
                    rangeSeparator: " ถึง ",
                    scrollTitle: "เลื่อนเพื่อเพิ่มหรือลด",
                    toggleTitle: "คลิกเพื่อเปลี่ยน",
                    ordinal: () => "",
                    time24hr: true
                };
            }

            const startDateFilter = document.getElementById('history-start-date-filter');
            const endDateFilter = document.getElementById('history-end-date-filter');
            if (!startDateFilter || !endDateFilter) return;
            
            const todayStr = getBangkokTodayDateStr();
            const currentStartVal = startDateFilter.value || todayStr;
            const currentEndVal = endDateFilter.value || todayStr;

            // Helper to update year display in calendar header to B.E. (พ.ศ.)
            const localizeFlatpickrYear = (instance) => {
                setTimeout(() => {
                    const calendar = instance.calendarContainer;
                    if (!calendar) return;
                    
                    const yearInput = calendar.querySelector(".cur-year");
                    if (yearInput) {
                        const gregYear = parseInt(yearInput.value || instance.currentYear, 10);
                        if (gregYear && gregYear < 2400) {
                            yearInput.value = gregYear + 543;
                        }
                    }
                }, 0);
            };
            
            if (!historyStartPicker) {
                historyStartPicker = flatpickr("#history-start-date-filter", {
                    locale: "th",
                    dateFormat: "Y-m-d",
                    defaultDate: currentStartVal,
                    disableMobile: true,
                    onReady: function(selectedDates, dateStr, instance) {
                        localizeFlatpickrYear(instance);
                        updateHistoryDateDisplay(dateStr, 'start');
                    },
                    onOpen: function(selectedDates, dateStr, instance) {
                        localizeFlatpickrYear(instance);
                    },
                    onMonthChange: function(selectedDates, dateStr, instance) {
                        localizeFlatpickrYear(instance);
                    },
                    onYearChange: function(selectedDates, dateStr, instance) {
                        localizeFlatpickrYear(instance);
                    },
                    onChange: function(selectedDates, dateStr) {
                        onHistoryStartDateChange(dateStr);
                    }
                });
            } else {
                historyStartPicker.setDate(currentStartVal, false);
                updateHistoryDateDisplay(currentStartVal, 'start');
            }
            
            if (!historyEndPicker) {
                historyEndPicker = flatpickr("#history-end-date-filter", {
                    locale: "th",
                    dateFormat: "Y-m-d",
                    defaultDate: currentEndVal,
                    disableMobile: true,
                    onReady: function(selectedDates, dateStr, instance) {
                        localizeFlatpickrYear(instance);
                        updateHistoryDateDisplay(dateStr, 'end');
                    },
                    onOpen: function(selectedDates, dateStr, instance) {
                        localizeFlatpickrYear(instance);
                    },
                    onMonthChange: function(selectedDates, dateStr, instance) {
                        localizeFlatpickrYear(instance);
                    },
                    onYearChange: function(selectedDates, dateStr, instance) {
                        localizeFlatpickrYear(instance);
                    },
                    onChange: function(selectedDates, dateStr) {
                        onHistoryEndDateChange(dateStr);
                    }
                });
            } else {
                historyEndPicker.setDate(currentEndVal, false);
                updateHistoryDateDisplay(currentEndVal, 'end');
            }
        }

        function switchTab(tabName) {
            if (!userData) return;
            activeTab = tabName;
            
            if (tabName === 'patrol') {
                showScreen(lastPatrolScreen);
            } else if (tabName === 'history') {
                const roundsVisible = !document.getElementById('screen-rounds').classList.contains('hidden');
                const checkpointsVisible = !document.getElementById('screen-checkpoints').classList.contains('hidden');
                const scannerVisible = !document.getElementById('screen-scanner').classList.contains('hidden');
                
                if (roundsVisible) lastPatrolScreen = 'rounds';
                else if (checkpointsVisible) lastPatrolScreen = 'checkpoints';
                else if (scannerVisible) lastPatrolScreen = 'scanner';
                
                showScreen('history');
                
                initHistoryFlatpickr();
                
                loadHistorySitesDropdown().then(() => {
                    fetchHistoryLogs();
                });
            }
        }

        function updateNavBarActiveState(screenId) {
            const navPatrolBtn = document.getElementById('nav-btn-patrol');
            const navHistoryBtn = document.getElementById('nav-btn-history');
            const navPatrolInd = document.getElementById('nav-indicator-patrol');
            const navHistoryInd = document.getElementById('nav-indicator-history');
            
            if (!navPatrolBtn || !navHistoryBtn) return;
            
            if (screenId === 'history') {
                navPatrolBtn.className = "flex flex-col items-center gap-1 text-slate-400 font-medium text-[10.5px] hover:text-slate-800 transition-colors relative flex-1";
                navHistoryBtn.className = "flex flex-col items-center gap-1 text-slate-800 font-extrabold text-[10.5px] transition-colors relative flex-1";
                if (navPatrolInd) navPatrolInd.classList.add('hidden');
                if (navHistoryInd) navHistoryInd.classList.remove('hidden');
            } else {
                navPatrolBtn.className = "flex flex-col items-center gap-1 text-slate-800 font-extrabold text-[10.5px] transition-colors relative flex-1";
                navHistoryBtn.className = "flex flex-col items-center gap-1 text-slate-400 font-medium text-[10.5px] hover:text-slate-800 transition-colors relative flex-1";
                if (navPatrolInd) navPatrolInd.classList.remove('hidden');
                if (navHistoryInd) navHistoryInd.classList.add('hidden');
            }
        }

        function onHistoryStartDateChange(value) {
            updateHistoryDateDisplay(value, 'start');
            fetchHistoryLogs();
        }

        function onHistoryEndDateChange(value) {
            updateHistoryDateDisplay(value, 'end');
            fetchHistoryLogs();
        }

        function updateHistoryDateDisplay(value, type) {
            const displayEl = document.getElementById(`history-${type}-date-display`);
            if (displayEl) {
                displayEl.innerText = formatThaiBuddhistDate(value);
            }
        }

        function formatThaiBuddhistDate(dateStr) {
            if (!dateStr) return "";
            try {
                const parts = dateStr.split('-');
                if (parts.length !== 3) return dateStr;
                const year = parseInt(parts[0], 10);
                const month = parseInt(parts[1], 10) - 1;
                const day = parseInt(parts[2], 10);
                
                const thaiYear = year + 543;
                
                const thaiMonthsShort = [
                    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", 
                    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
                ];
                
                return `${day} ${thaiMonthsShort[month]} ${thaiYear}`;
            } catch (e) {
                return dateStr;
            }
        }

        async function loadHistorySitesDropdown() {
            const selectEl = document.getElementById('history-site-select');
            if (!selectEl) return;
            
            const defaultSite = activeSite || "";
            let sites = [];
            if (defaultSite) {
                sites.push(defaultSite);
            }
            
            const guardEmpId = userData ? userData.emp_id : "";
            if (supabaseClient && guardEmpId) {
                try {
                    const { data, error } = await supabaseClient
                        .from('patrol_logs')
                        .select('unit_name')
                        .eq('guard_emp_id', guardEmpId);
                    
                    if (!error && data) {
                        const loggedSites = data.map(item => item.unit_name).filter(Boolean);
                        loggedSites.forEach(s => {
                            if (!sites.includes(s)) {
                                sites.push(s);
                            }
                        });
                    }
                } catch (e) {
                    console.error("loadHistorySitesDropdown error:", e);
                }
            }
            
            let html = '';
            sites.forEach(site => {
                const isCurrent = (site === defaultSite);
                html += `<option value="${site}" ${isCurrent ? 'selected' : ''}>${site}${isCurrent ? ' (ไซต์ปัจจุบัน)' : ''}</option>`;
            });
            
            selectEl.innerHTML = html || `<option value="">ไม่มีข้อมูลไซต์งาน</option>`;
        }

        async function fetchHistoryLogs() {
            const container = document.getElementById('history-list-container');
            const totalBadge = document.getElementById('history-total-badge');
            if (!container) return;
            
            container.innerHTML = `
                <div class="p-4 bg-white rounded-2xl border border-slate-200 text-center py-8">
                    <i class="fas fa-circle-notch animate-spin text-slate-400 text-xl mb-2"></i>
                    <p class="text-xs text-slate-500 font-medium">กำลังโหลดรายงานสรุปผล...</p>
                </div>
            `;
            
            const startDateEl = document.getElementById('history-start-date-filter');
            const endDateEl = document.getElementById('history-end-date-filter');
            const siteSelectEl = document.getElementById('history-site-select');
            
            const startDateVal = startDateEl ? (startDateEl.value || getBangkokTodayDateStr()) : getBangkokTodayDateStr();
            const endDateVal = endDateEl ? (endDateEl.value || getBangkokTodayDateStr()) : getBangkokTodayDateStr();
            const targetSite = siteSelectEl ? siteSelectEl.value : activeSite;
            
            // Sync date displays
            updateHistoryDateDisplay(startDateVal, 'start');
            updateHistoryDateDisplay(endDateVal, 'end');
            
            if (!supabaseClient) {
                container.innerHTML = `
                    <div class="p-4 bg-white rounded-2xl border border-slate-200 text-center py-8 text-red-500">
                        <i class="fas fa-exclamation-triangle text-xl mb-2"></i>
                        <p class="text-xs font-bold">ระบบขัดข้อง: ไม่พบการเชื่อมต่อฐานข้อมูล</p>
                    </div>
                `;
                return;
            }
            
            try {
                // 1. Fetch Rounds (ascending order: Round 1-2-3-4...)
                const { data: dbRounds } = await supabaseClient
                    .from('patrol_rounds')
                    .select('*')
                    .eq('site_name', targetSite)
                    .order('start_time', { ascending: true });
                
                // 2. Fetch Checkpoints for total count and detail displaying
                const { data: dbCheckpoints } = await supabaseClient
                    .from('patrol_checkpoints')
                    .select('code, name')
                    .eq('site_name', targetSite);
                    
                const totalCP = dbCheckpoints ? dbCheckpoints.length : 0;
                
                // 3. Fetch Logs
                const { data: dbLogs, error: logError } = await supabaseClient
                    .from('patrol_logs')
                    .select('*')
                    .eq('unit_name', targetSite)
                    .gte('timestamp', `${startDateVal}T00:00:00+07:00`)
                    .lte('timestamp', `${endDateVal}T23:59:59+07:00`);
                    
                if (logError) throw logError;

                // Create dates array using local timezone components to prevent UTC date-shifting
                const datesArray = [];
                let currDate = new Date(`${startDateVal}T00:00:00`);
                const lastDate = new Date(`${endDateVal}T00:00:00`);
                // safety limit for arbitrary ranges
                let loopCount = 0;
                while (currDate <= lastDate && loopCount < 365) {
                    const y = currDate.getFullYear();
                    const m = String(currDate.getMonth() + 1).padStart(2, '0');
                    const d = String(currDate.getDate()).padStart(2, '0');
                    datesArray.push(`${y}-${m}-${d}`);
                    currDate.setDate(currDate.getDate() + 1);
                    loopCount++;
                }
                datesArray.reverse(); // newest first

                const now = new Date();
                const nowMs = now.getHours() * 60 + now.getMinutes();
                const todayStr = getBangkokTodayDateStr();
                
                let html = '<div class="space-y-4">';
                let totalRoundsDisplayed = 0;
                window.historyRoundData = {}; // Clear global cache for modals
                
                datesArray.forEach(dateStr => {
                    const dayLogs = dbLogs.filter(l => getBangkokTodayDateStr(l.timestamp) === dateStr);
                    
                    const isToday = (dateStr === todayStr);
                    const dateObj = new Date(`${dateStr}T00:00:00`);
                    const todayObj = new Date(`${todayStr}T00:00:00`);
                    
                    // Filter rounds to only show past/current rounds, or rounds with actual data
                    const activeRounds = (dbRounds || []).filter(round => {
                        const roundLogs = dayLogs.filter(l => l.round_name === round.name);
                        if (roundLogs.length > 0) return true; // always show if there's data
                        
                        if (dateObj > todayObj) return false;
                        
                        const [startH, startM] = round.start_time.split(':').map(Number);
                        const roundStartMs = startH * 60 + startM;
                        if (isToday && nowMs < roundStartMs) return false;
                        
                        return true;
                    });
                    
                    if (activeRounds.length === 0) return; // skip rendering this day entirely
                    
                    html += `
                    <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm mb-4 last:mb-0">
                        <div class="bg-slate-50 border-b border-slate-200 px-3 py-2 flex items-center justify-between">
                            <span class="font-extrabold text-slate-800 text-xs"><i class="far fa-calendar-alt text-slate-400 mr-1.5"></i> วันที่ ${formatThaiBuddhistDate(dateStr)}</span>
                        </div>
                    `;
                    
                    activeRounds.forEach(round => {
                        totalRoundsDisplayed++;
                        const roundLogs = dayLogs.filter(l => l.round_name === round.name);
                        
                        const uniqueCps = new Set();
                        let guardName = "-";
                        roundLogs.forEach(l => {
                            uniqueCps.add(l.checkpoint_code || l.checkpoint_name);
                            if (l.guard_name && guardName === "-") guardName = l.guard_name;
                        });
                        const scannedCount = uniqueCps.size;
                        
                        let statusConfig = { text: 'ไม่ทราบสถานะ', bg: 'bg-slate-100', textCol: 'text-slate-600', icon: 'fa-circle' };
                        
                        const isToday = (dateStr === todayStr);
                        const [startH, startM] = round.start_time.split(':').map(Number);
                        const [endH, endM] = round.end_time.split(':').map(Number);
                        const roundStartMs = startH * 60 + startM;
                        const roundEndMs = endH * 60 + endM;
                        
                        if (scannedCount >= totalCP && totalCP > 0) {
                            statusConfig = { text: 'ครบถ้วน', bg: 'bg-emerald-50 border-emerald-200', textCol: 'text-emerald-600', icon: 'fa-check-circle' };
                        } else if (scannedCount > 0 && scannedCount < totalCP) {
                            if (isToday && nowMs >= roundStartMs && nowMs <= roundEndMs) {
                                statusConfig = { text: 'กำลังตรวจ', bg: 'bg-amber-50 border-amber-200', textCol: 'text-amber-600', icon: 'fa-spinner fa-spin' };
                            } else {
                                statusConfig = { text: 'ไม่ครบ', bg: 'bg-red-50 border-red-200', textCol: 'text-red-600', icon: 'fa-exclamation-circle' };
                            }
                        } else if (scannedCount === 0) {
                            const dateObj = new Date(`${dateStr}T00:00:00`);
                            const todayObj = new Date(`${todayStr}T00:00:00`);
                            if (dateObj > todayObj || (isToday && nowMs < roundStartMs)) {
                                statusConfig = { text: 'รอเวลา', bg: 'bg-slate-50 border-slate-200', textCol: 'text-slate-400', icon: 'fa-clock' };
                            } else {
                                statusConfig = { text: 'ขาดตรวจ', bg: 'bg-red-50 border-red-200', textCol: 'text-red-600', icon: 'fa-times-circle' };
                            }
                        }
                        
                        const roundKey = `${dateStr}_${round.name}`;
                        window.historyRoundData[roundKey] = { logs: roundLogs, checkpoints: dbCheckpoints };
                        
                        html += `
                        <div onclick="showRoundDetailsModal('${dateStr}', '${round.name}', '${round.start_time}-${round.end_time}', '${roundKey}')" class="px-3 py-3 flex items-center justify-between border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors cursor-pointer active:bg-slate-100 group">
                            <div class="flex-1 min-w-0 pr-2">
                                <div class="flex items-center gap-1.5 mb-1">
                                    <span class="text-slate-900 font-extrabold text-[12px] truncate group-hover:text-emerald-700 transition-colors">${round.name}</span>
                                    <span class="text-slate-400 text-[10px] font-bold shrink-0">(${round.start_time}-${round.end_time})</span>
                                </div>
                                <div class="text-[10px] font-bold text-slate-500 truncate">
                                    สแกนแล้ว: <span class="${scannedCount >= totalCP ? 'text-emerald-600' : (scannedCount > 0 ? 'text-amber-600' : 'text-slate-400')}">${scannedCount}/${totalCP} จุด</span>
                                    ${guardName !== "-" ? ` <span class="text-slate-300 mx-0.5">|</span> รปภ: ${guardName}` : ''}
                                </div>
                            </div>
                            <div class="flex-shrink-0 flex items-center gap-2">
                                <span class="px-2.5 py-1.5 rounded-lg border text-[10px] font-extrabold flex items-center gap-1.5 ${statusConfig.bg} ${statusConfig.textCol} shadow-sm">
                                    <i class="fas ${statusConfig.icon}"></i> ${statusConfig.text}
                                </span>
                                <i class="fas fa-chevron-right text-slate-300 text-[10px] group-hover:text-emerald-500 transition-colors"></i>
                            </div>
                        </div>
                        `;
                    });
                    
                    html += `</div>`;
                });
                
                html += '</div>';
                
                if (totalBadge) totalBadge.innerText = `${totalRoundsDisplayed} รอบการตรวจ`;
                
                if (totalRoundsDisplayed === 0) {
                    container.innerHTML = `
                        <div class="p-8 bg-white rounded-2xl border border-slate-200 text-center text-slate-500">
                            <i class="fas fa-folder-open text-3xl mb-2 text-slate-355"></i>
                            <p class="text-xs font-bold">ไม่พบข้อมูลรอบการตรวจในวันที่เลือก</p>
                        </div>
                    `;
                } else {
                    container.innerHTML = html;
                }
                
            } catch (e) {
                console.error("fetchHistoryLogs catch error:", e);
                container.innerHTML = `
                    <div class="p-4 bg-white rounded-2xl border border-slate-200 text-center py-8 text-red-500">
                        <i class="fas fa-exclamation-triangle text-xl mb-2"></i>
                        <p class="text-xs font-bold">ระบบล้มเหลวขณะประมวลผลข้อมูล</p>
                        <p class="text-[10px] text-slate-400 mt-1">${e.message}</p>
                    </div>
                `;
            }
        }

        function showRoundDetailsModal(dateStr, roundName, roundTime, roundKey) {
            const data = window.historyRoundData[roundKey];
            if (!data) return;
            const { logs, checkpoints } = data;
            
            const formattedDate = formatThaiBuddhistDate(dateStr);
            const todayStr = getBangkokTodayDateStr();
            const now = new Date();
            const nowMs = now.getHours() * 60 + now.getMinutes();
            
            let html = `
            <div class="text-left font-sans text-xs space-y-3">
                <div class="flex justify-between items-center bg-slate-100 p-2.5 rounded-xl border border-slate-200">
                    <span class="font-extrabold text-slate-800"><i class="far fa-calendar-alt mr-1"></i> วันที่: ${formattedDate}</span>
                    <span class="font-extrabold text-slate-600"><i class="far fa-clock mr-1"></i> เวลา: ${roundTime} น.</span>
                </div>
                
                <div class="space-y-3 max-h-[350px] overflow-y-auto pr-1 custom-scroll">
            `;
            
            if (!checkpoints || checkpoints.length === 0) {
                html += `
                <div class="text-center py-6 text-slate-400 font-bold">
                    <i class="fas fa-info-circle text-lg mb-1 block"></i>
                    ไม่มีข้อมูลจุดตรวจในไซต์งานนี้
                </div>
                `;
            } else {
                checkpoints.forEach((cp, index) => {
                    const cpLog = logs.find(l => l.checkpoint_code === cp.code || (l.checkpoint_name && l.checkpoint_name === cp.name));
                    
                    if (cpLog) {
                        const timeStr = formatLogTime(cpLog.timestamp);
                        const guardStr = cpLog.guard_name || "ไม่ทราบชื่อ";
                        const noteStr = cpLog.note || "";
                        
                        let photosHtml = '';
                        const photoUrls = [cpLog.photo_url_1, cpLog.photo_url_2, cpLog.photo_url_3].filter(Boolean);
                        if (photoUrls.length > 0) {
                            photosHtml += `<div class="flex gap-2 mt-2">`;
                            photoUrls.forEach((url, i) => {
                                const escapedUrls = JSON.stringify(photoUrls).replace(/"/g, '&quot;');
                                photosHtml += `
                                <div class="relative w-14 h-14 rounded-xl overflow-hidden border border-slate-200 shadow-sm cursor-pointer hover:opacity-95 hover:scale-[1.02] active:scale-95 transition-all shrink-0" onclick="openLightbox('${url}', '${escapedUrls}')">
                                    <img src="${url}" class="w-full h-full object-cover">
                                    <span class="absolute bottom-0.5 right-1 bg-black/60 text-white text-[8px] px-1 rounded-sm font-extrabold">${i+1}</span>
                                </div>
                                `;
                            });
                            photosHtml += `</div>`;
                        }
                        
                        let gpsHtml = '';
                        if (cpLog.gps_location) {
                            gpsHtml = `
                            <a href="https://www.google.com/maps/search/?api=1&query=${cpLog.gps_location}" target="_blank" class="inline-flex items-center gap-1 text-[9px] font-extrabold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-lg border border-slate-250 mt-1 transition-all active:scale-95">
                                <i class="fas fa-map-marker-alt text-red-500"></i> ดูพิกัดแผนที่
                            </a>
                            `;
                        }
                        
                        html += `
                        <div class="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm hover:border-emerald-200 transition-colors">
                            <div class="flex items-start justify-between">
                                <div class="flex items-center gap-2 min-w-0">
                                    <span class="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px] font-extrabold shrink-0">${index + 1}</span>
                                    <div class="min-w-0">
                                        <p class="font-extrabold text-slate-800 text-xs truncate">${cp.name || cp.code}</p>
                                        <p class="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider">CODE: ${cp.code}</p>
                                    </div>
                                </div>
                                <div class="text-right shrink-0">
                                    <span class="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 text-[9px] font-extrabold flex items-center gap-1">
                                        <i class="fas fa-check-circle"></i> สแกนแล้ว
                                    </span>
                                    <span class="text-[9.5px] font-bold text-slate-500 block mt-1"><i class="far fa-clock mr-0.5 text-slate-400"></i> ${timeStr} น.</span>
                                </div>
                            </div>
                            
                            <div class="mt-2 pl-7 border-l-2 border-slate-100 space-y-1.5">
                                <p class="text-[10px] text-slate-600 font-bold">รปภ: <span class="text-slate-800 font-extrabold">${guardStr}</span></p>
                                ${noteStr ? `<p class="text-[10px] text-slate-600 bg-slate-50 border border-slate-100 p-2 rounded-xl mt-1 font-medium leading-relaxed"><i class="far fa-comment-dots text-slate-400 mr-1"></i> ${noteStr}</p>` : ''}
                                <div class="flex flex-wrap gap-2 items-center">
                                    ${gpsHtml}
                                    ${photosHtml}
                                </div>
                            </div>
                        </div>
                        `;
                    } else {
                        // Checkpoint was not scanned
                        let statusText = 'ขาดการตรวจ';
                        let statusBg = 'bg-red-50 text-red-650 border-red-200';
                        let statusIcon = 'fa-times-circle';
                        
                        const dateObj = new Date(`${dateStr}T00:00:00`);
                        const todayObj = new Date(`${todayStr}T00:00:00`);
                        const [startH, startM] = roundTime.split('-')[0].split(':').map(Number);
                        const roundStartMs = startH * 60 + startM;
                        
                        if (dateObj > todayObj || (dateStr === todayStr && nowMs < roundStartMs)) {
                            statusText = 'รอคิวสแกน';
                            statusBg = 'bg-slate-50 text-slate-400 border-slate-200';
                            statusIcon = 'fa-clock';
                        }
                        
                        html += `
                        <div class="bg-slate-50/75 border border-slate-200 rounded-2xl p-3 shadow-sm">
                            <div class="flex items-start justify-between">
                                <div class="flex items-center gap-2 min-w-0">
                                    <span class="w-5 h-5 rounded-full bg-slate-250 text-slate-500 flex items-center justify-center text-[10px] font-extrabold shrink-0">${index + 1}</span>
                                    <div class="min-w-0">
                                        <p class="font-extrabold text-slate-600 text-xs truncate">${cp.name || cp.code}</p>
                                        <p class="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider">CODE: ${cp.code}</p>
                                    </div>
                                </div>
                                <div>
                                    <span class="px-2 py-0.5 rounded-full ${statusBg} text-[9px] font-extrabold flex items-center gap-1 shrink-0">
                                        <i class="fas ${statusIcon}"></i> ${statusText}
                                    </span>
                                </div>
                            </div>
                        </div>
                        `;
                    }
                });
            }
            
            html += `
                </div>
            </div>
            `;
            
            Swal.fire({
                title: roundName,
                html: html,
                showCloseButton: true,
                showConfirmButton: false,
                width: '380px',
                customClass: {
                    popup: 'rounded-3xl border border-slate-200 shadow-xl bg-slate-50 font-sans',
                    title: 'text-slate-900 font-extrabold text-sm border-b border-slate-200 pb-3.5 mb-2 mx-4 pt-4 text-center',
                    closeButton: 'text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-0'
                }
            });
        }

        function formatLogTime(timestampStr) {
            if (!timestampStr) return "";
            try {
                const dateObj = new Date(timestampStr);
                if (isNaN(dateObj.getTime())) {
                    const parts = timestampStr.split('T');
                    if (parts.length > 1) {
                        return parts[1].slice(0, 5);
                    }
                    return "";
                }
                return dateObj.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
            } catch (e) {
                console.error("Error formatting log time:", e);
                return "";
            }
        }

        function formatLogDate(timestampStr) {
            if (!timestampStr) return "";
            try {
                const dateObj = new Date(timestampStr);
                if (isNaN(dateObj.getTime())) {
                    const parts = timestampStr.split('T');
                    const dParts = parts[0].split('-');
                    if (dParts.length === 3) {
                        let yr = parseInt(dParts[0], 10);
                        if (yr < 2400) yr += 543;
                        return `${dParts[2]}/${dParts[1]}/${yr}`;
                    }
                    return parts[0] || "";
                }
                const day = String(dateObj.getDate()).padStart(2, '0');
                const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                let year = dateObj.getFullYear();
                if (year < 2400) year += 543;
                return `${day}/${month}/${year}`;
            } catch (e) {
                console.error("Error formatting log date:", e);
                return "";
            }
        }

        function formatLogDateShort(timestampStr) {
            if (!timestampStr) return "";
            try {
                const dateObj = new Date(timestampStr);
                let day = "";
                let month = "";
                let yearBE = 0;
                
                if (isNaN(dateObj.getTime())) {
                    const parts = timestampStr.split('T');
                    const dParts = parts[0].split('-');
                    if (dParts.length === 3) {
                        day = dParts[2];
                        month = dParts[1];
                        yearBE = parseInt(dParts[0], 10);
                        if (yearBE < 2400) yearBE += 543;
                    } else {
                        return parts[0] || "";
                    }
                } else {
                    day = String(dateObj.getDate()).padStart(2, '0');
                    month = String(dateObj.getMonth() + 1).padStart(2, '0');
                    yearBE = dateObj.getFullYear();
                    if (yearBE < 2400) yearBE += 543;
                }
                
                const shortYear = String(yearBE).slice(-2);
                return `${day}/${month}/${shortYear}`;
            } catch (e) {
                console.error("Error formatting log date short:", e);
                return "";
            }
        }

        let lightboxUrls = [];
        let activeLightboxIndex = 0;

        function openLightbox(url, urlsJsonStr) {
            const lightbox = document.getElementById('photo-lightbox');
            const img = document.getElementById('lightbox-img');
            if (!lightbox || !img) return;

            lightboxUrls = [];
            try {
                if (urlsJsonStr) {
                    lightboxUrls = JSON.parse(urlsJsonStr).filter(u => u);
                }
            } catch (e) {}

            if (lightboxUrls.length === 0) {
                lightboxUrls = [url];
            }

            activeLightboxIndex = lightboxUrls.indexOf(url);
            if (activeLightboxIndex === -1) activeLightboxIndex = 0;

            renderLightboxImage();
            lightbox.classList.remove('hidden');
            lightbox.classList.add('flex');
        }

        function renderLightboxImage() {
            const img = document.getElementById('lightbox-img');
            if (!img || lightboxUrls.length === 0) return;

            img.src = lightboxUrls[activeLightboxIndex];

            // Render thumbnail nav at the bottom of the lightbox
            let navContainer = document.getElementById('lightbox-nav-thumbnails');
            if (!navContainer) {
                navContainer = document.createElement('div');
                navContainer.id = 'lightbox-nav-thumbnails';
                navContainer.className = "absolute bottom-6 left-0 right-0 flex justify-center gap-2 z-70";
                document.getElementById('photo-lightbox').appendChild(navContainer);
            }

            if (lightboxUrls.length > 1) {
                navContainer.innerHTML = lightboxUrls.map((url, index) => {
                    const isActive = index === activeLightboxIndex;
                    return `
                        <div onclick="event.stopPropagation(); setLightboxIndex(${index})" class="w-10 h-10 rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${isActive ? 'border-white scale-110 shadow-lg' : 'border-white/30 hover:border-white/60'}">
                            <img src="${url}" class="w-full h-full object-cover">
                        </div>
                    `;
                }).join('');
                navContainer.classList.remove('hidden');
            } else {
                navContainer.classList.add('hidden');
            }
        }

        function setLightboxIndex(index) {
            activeLightboxIndex = index;
            renderLightboxImage();
        }

        function closeLightbox() {
            const lightbox = document.getElementById('photo-lightbox');
            const img = document.getElementById('lightbox-img');
            if (lightbox && img) {
                lightbox.classList.remove('flex');
                lightbox.classList.add('hidden');
                img.src = "";
            }
            const navContainer = document.getElementById('lightbox-nav-thumbnails');
            if (navContainer) {
                navContainer.innerHTML = "";
                navContainer.classList.add('hidden');
            }
        }

        document.addEventListener('DOMContentLoaded', () => {
            try {
                updateLiveDate();
            } catch (e) {
                console.error("updateLiveDate failed:", e);
            }
            
            try {
                setInterval(() => {
                    try {
                        updateLiveDate();
                        // Sync status from server in background to keep multiple devices updated
                        if (userData) {
                            fetchRoundsAndCheckpoints();
                        }
                    } catch (e) {
                        console.error("Interval updateLiveDate/sync failed:", e);
                    }
                }, 30000);
            } catch (e) {
                console.error("setInterval failed:", e);
            }

            // Periodically check for round transitions (every 10 seconds)
            try {
                setInterval(() => {
                    try {
                        checkRoundTimeTransitions();
                    } catch (e) {
                        console.error("Interval checkRoundTimeTransitions failed:", e);
                    }
                }, 10000);
            } catch (e) {
                console.error("setInterval for transitions failed:", e);
            }

            try {
                loadUserSession();
            } catch (e) {
                console.error("loadUserSession failed:", e);
            }
        });
