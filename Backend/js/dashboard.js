// --- Configuration & Helpers ---
        const STORAGE_URL = 'https://mvcsbylbsffgbkocehzx.supabase.co/storage/v1/object/public/NEXTGEN/';
        
        function getImageUrl(path, name) {
            if (!path || path.trim() === '') return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=f59e0b&color=fff&bold=true`;
            if (path.startsWith('http')) return path;
            return STORAGE_URL + path.trim();
        }

        // --- Session Guard ---
        let userData = JSON.parse(localStorage.getItem('nextgen_user'));
        if (!userData && sessionStorage.getItem('nextgen_user')) {
            localStorage.setItem('nextgen_user', sessionStorage.getItem('nextgen_user'));
            userData = JSON.parse(sessionStorage.getItem('nextgen_user'));
        }

        if (!userData || !userData.level) {
            window.location.href = '../index.html';
        } else {
            const userLvl = userData.level.trim().toLowerCase();
            if (userLvl !== 'admin' && userLvl !== 'manager' && userLvl !== 'owner') {
                window.location.href = '../index.html';
            }
        }

        // --- State ---
        let staffData = [];
        let unitsData = [];
        let editingEmpId = null;
        let lineChart, barChart;
        let currentPage = 1;
        let itemsPerPage = 50; // Initial load, will increase on scroll
        let filteredData = [];
        let lastActiveMap = {}; // Global storage for inactivity check
        let selectedItems = new Set();

        // --- Initialization ---
        document.addEventListener('DOMContentLoaded', async () => {
            if (userData) {
                // Populate User Name & Level
                if (document.getElementById('userName')) document.getElementById('userName').innerText = userData.name || 'Admin User';
                if (document.getElementById('userLevel')) document.getElementById('userLevel').innerText = userData.level || 'Administrator';
            }

            initChart();
            
            // Load essential dashboard stats first
            updateDashboardStats(); 

            // Fetch data in background without blocking the UI
            fetchUnits();
            fetchStaff();
            fetchLeaves();
            fetchFinance();
            fetchWorkingGuardsCount();
            fetchWeeklyStats();
            fetchReportCounts();
            
            // Start Digital Clock
            updateClock();
            setInterval(updateClock, 1000);

            // Handle Hash Routing (e.g., dashboard.html#staff)
            const hash = window.location.hash.replace('#', '');
            if (hash) {
                // Find menu item that matches this hash
                const menuItem = document.querySelector(`.menu-item[onclick*="'${hash}'"]`) || 
                                 document.querySelector(`.submenu-item[onclick*="'${hash}'"]`);
                switchTab(hash, menuItem);
            } else {
                const defaultMenuItem = document.querySelector(`.menu-item[onclick*="'dashboard'"]`);
                switchTab('dashboard', defaultMenuItem);
            }
        });

        function updateClock() {
            const options = { timeZone: 'Asia/Bangkok' };
            const now = new Date();
            const timeStr = now.toLocaleTimeString('th-TH', { ...options, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            const dateStr = now.toLocaleDateString('th-TH', { ...options, day: '2-digit', month: 'long', year: 'numeric' });
            
            if (document.getElementById('digitalClock')) document.getElementById('digitalClock').innerText = timeStr;
            if (document.getElementById('digitalDate')) document.getElementById('digitalDate').innerText = dateStr;
            if (document.getElementById('systemTime')) document.getElementById('systemTime').innerText = timeStr;
        }

        function initChart() {
            const ctx = document.getElementById('dashboardChart').getContext('2d');
            let gradient = ctx.createLinearGradient(0, 0, 0, 300);
            gradient.addColorStop(0, 'rgba(245, 158, 11, 0.4)');
            gradient.addColorStop(1, 'rgba(245, 158, 11, 0)');

            lineChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'],
                    datasets: [{
                        label: 'จำนวนการเข้าตรวจ (ครั้ง)',
                        data: [18, 22, 20, 24, 21, 26, 23],
                        borderColor: '#f59e0b',
                        backgroundColor: gradient,
                        borderWidth: 3,
                        tension: 0.4,
                        fill: true,
                        pointBackgroundColor: '#0f172a',
                        pointBorderColor: '#f59e0b',
                        pointBorderWidth: 2,
                        pointRadius: 4
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
            });

        }

        // --- Dashboard Logic ---
        function updateDashboardStats() {
            // 1. หน่วยงาน
            const activeUnits = unitsData.filter(u => u.status !== 'ปิด');
            if (document.getElementById('unitCount')) document.getElementById('unitCount').innerText = activeUnits.length;

            // 2. พนักงาน (Level: Guard & Status: เปิด)
            const activeStaff = staffData.filter(s => s.status === 'เปิด');
            if (document.getElementById('staffCount')) document.getElementById('staffCount').innerText = activeStaff.length;

            // 3. กำลังปฏิบัติงาน (ย้ายไปนับจาก duty_logs ผ่านฟังก์ชัน fetchWorkingGuardsCount)
            // เพื่อให้แสดงผลลัพธ์ที่ถูกต้องและอัปเดตแบบเรียลไทม์
            
            // 4. แจ้งเตือน (Removed in new layout, replaced by connection status)
            const alertEl = document.getElementById('alertCount');
            if (alertEl) alertEl.innerText = 0;

            // Zone Equalizer (Exclude null/empty/whitespace)
            const zoneEqContainer = document.getElementById('zoneEqContainer');
            if (zoneEqContainer) {
                const zoneCounts = {};
                activeUnits.forEach(u => {
                    const z = (u.zone || '').trim();
                    if (z && z !== '-' && z.toLowerCase() !== 'null') {
                        zoneCounts[z] = (zoneCounts[z] || 0) + 1;
                    }
                });
                
                const entries = Object.entries(zoneCounts).sort((a,b) => b[1] - a[1]);
                if (entries.length === 0) {
                    zoneEqContainer.innerHTML = '<p class="text-slate-500 text-xs py-4 text-center italic">ไม่มีข้อมูลพื้นที่</p>';
                } else {
                    const maxVal = Math.max(...entries.map(e => e[1]), 1);
                    const colors = ['bg-emerald-500', 'bg-cyan-500', 'bg-amber-500', 'bg-rose-500', 'bg-purple-500', 'bg-blue-500', 'bg-pink-500'];
                    let html = '';
                    entries.forEach(([name, value], idx) => {
                        const colorClass = colors[idx % colors.length];
                        const textColorClass = colorClass.replace('bg-', 'text-');
                        
                        // Increase segments to 20 and use flex-1 to fill the whole width beautifully
                        const segments = 20; 
                        let filled = Math.ceil((value / maxVal) * segments);
                        if (value > 0 && filled === 0) filled = 1;
                        
                        let barsHtml = '';
                        for (let i = 0; i < segments; i++) {
                            if (i < filled) {
                                barsHtml += `<div class="h-3 flex-1 ${colorClass} rounded-sm shadow-[0_0_5px_currentColor]"></div>`;
                            } else {
                                barsHtml += `<div class="h-3 flex-1 bg-slate-800/80 rounded-sm"></div>`;
                            }
                        }
                        
                        html += `
                            <div class="flex items-center gap-3 group mb-2.5">
                                <span class="w-16 text-[10px] text-slate-400 font-bold truncate group-hover:text-white transition-colors" title="${name}">${name}</span>
                                <div class="flex-1 flex gap-[2px] items-center">
                                    ${barsHtml}
                                </div>
                                <span class="text-xs font-black ${textColorClass} w-6 text-right">${value}</span>
                            </div>
                        `;
                    });
                    zoneEqContainer.innerHTML = html;
                }
            }
        }

        function renderEqualizer(containerId, dataObj, bgColorClass, textColorClass) {
            const container = document.getElementById(containerId);
            if (!container) return;
            container.innerHTML = '';
            
            const entries = Object.entries(dataObj).sort((a,b) => b[1] - a[1]).slice(0, 5); // top 5
            if (entries.length === 0) {
                container.innerHTML = '<p class="text-slate-500 text-xs text-center">ไม่มีข้อมูล</p>';
                return;
            }
            const maxVal = Math.max(...entries.map(e => e[1]), 1);
            
            for (const [name, value] of entries) {
                const segments = 12;
                const filled = Math.ceil((value / maxVal) * segments);
                
                let barsHtml = '';
                for (let i = 0; i < segments; i++) {
                    if (i < filled) {
                        barsHtml += `<div class="h-3 w-1.5 ${bgColorClass} rounded-sm opacity-${80 - (i*5)}"></div>`;
                    } else {
                        barsHtml += `<div class="h-3 w-1.5 bg-slate-800 rounded-sm"></div>`;
                    }
                }
                
                container.innerHTML += `
                    <div class="flex items-center gap-2 group">
                        <span class="w-20 text-[10px] text-slate-400 font-bold truncate group-hover:text-white transition-colors" title="${name}">${name}</span>
                        <div class="flex-1 flex gap-1 items-center">
                            ${barsHtml}
                        </div>
                        <span class="text-[10px] font-black ${textColorClass}">${value}</span>
                    </div>
                `;
            }
        }

        // --- Live Activity Logic ---
        async function fetchLiveActivity() {
            try {
                // ดึงข้อมูล 20 รายการล่าสุด เฉพาะ Supervisor โดยใช้ emp_id จาก staffData (เนื่องจาก role ในตาราง duty_logs ว่าง)
                const supervisorIds = staffData.filter(s => s.level === 'Supervisor' || s.level === 'Manager').map(s => s.id);
                if (supervisorIds.length === 0) {
                    renderLiveFeed([]);
                    return;
                }

                const { data, error } = await supabaseClient
                    .from('duty_logs')
                    .select('*')
                    .in('emp_id', supervisorIds)
                    .order('timestamp', { ascending: false })
                    .limit(20);

                if (error) throw error;
                
                // แนบ role จาก staffData กลับเข้าไปให้ log
                const logsWithRole = data.map(log => {
                    const staff = staffData.find(s => s.id === log.emp_id);
                    return {
                        ...log,
                        role: staff ? staff.role : 'Supervisor'
                    };
                });
                
                renderLiveFeed(logsWithRole);
            } catch (err) {
                console.error('Error fetching live activity:', err);
                renderLiveFeed([]);
            }
        }

        // --- Reports Stats Logic ---
        async function fetchReportCounts() {
            try {
                // OP05
                const { count: countOP05, error: err1 } = await supabaseClient.from('op05_reports').select('*', { count: 'exact', head: true });
                if (!err1) updateReportCard('OP05', countOP05 || 0, 'bg-primary');
                
                // OP06
                const { count: countOP06, error: err2 } = await supabaseClient.from('op06_reports').select('*', { count: 'exact', head: true });
                if (!err2) updateReportCard('OP06', countOP06 || 0, 'bg-emerald-500');

                // OP07
                const { count: countOP07, error: err3 } = await supabaseClient.from('op07_reports').select('*', { count: 'exact', head: true });
                if (!err3) updateReportCard('OP07', countOP07 || 0, 'bg-amber-500');

                // FMQC02
                const { count: countFMQC02, error: err4 } = await supabaseClient.from('fmqc02_reports').select('*', { count: 'exact', head: true });
                if (!err4) updateReportCard('FMQC02', countFMQC02 || 0, 'bg-cyan-500');

            } catch (err) {
                console.error("Error fetching report counts", err);
            }
        }

        function updateReportCard(id, count, colorClass) {
            const el = document.getElementById(`count${id}`);
            if (el) el.innerText = count;
            
            const eqContainer = document.getElementById(`eq${id}`);
            if (eqContainer) {
                const segments = 15;
                const max = 100; // Visual scale (สมมติเป้าหมายสูงสุด)
                let filled = Math.ceil((count / max) * segments);
                if (count > 0 && filled === 0) filled = 1;
                if (filled > segments) filled = segments;
                
                let barsHtml = '';
                for (let i = 0; i < segments; i++) {
                    if (i < filled) {
                        const opacity = 1 - (i * 0.04);
                        barsHtml += `<div class="h-2 flex-1 ${colorClass} rounded-sm" style="opacity: ${opacity}"></div>`;
                    } else {
                        barsHtml += `<div class="h-2 flex-1 bg-slate-800 rounded-sm"></div>`;
                    }
                }
                eqContainer.innerHTML = barsHtml;
            }
        }

        async function fetchWorkingGuardsCount() {
            try {
                // Get today's start date (00:00:00) in Bangkok local time
                const now = new Date();
                const tzOffset = 7 * 60 * 60 * 1000; // GMT+7
                const localTime = new Date(now.getTime() + tzOffset);
                const todayThaiStr = localTime.toISOString().split('T')[0] + 'T00:00:00+07:00';

                // Fetch duty logs for the current day (starting from 00:00:00 Bangkok time)
                const { data, error } = await supabaseClient
                    .from('duty_logs')
                    .select('emp_id, action_type, role, timestamp')
                    .gte('timestamp', todayThaiStr)
                    .order('timestamp', { ascending: false })
                    .limit(2000);
                    
                if (error) throw error;
                
                // Group by emp_id to get the latest action of each unique employee today
                const latestStatus = {};
                data.forEach(log => {
                    if (log.emp_id && !latestStatus[log.emp_id]) {
                        latestStatus[log.emp_id] = log;
                    }
                });
                
                let workingCount = 0;
                for (const emp in latestStatus) {
                    const log = latestStatus[emp];
                    const action = (log.action_type || '').toLowerCase();
                    const role = (log.role || '').toLowerCase();
                    
                    // A guard is active if their latest action today is 'check_in' (excluding leave and check-out)
                    if (action.includes('in') && !action.includes('leave') && !action.includes('out')) {
                        // Check if they are a Guard (case-insensitive check for english and thai roles)
                        let isGuard = role.includes('guard') || role.includes('รปภ');
                        
                        // Fallback check against staffData if role inside the log was empty
                        if (!role && staffData.length > 0) {
                            const staff = staffData.find(s => s.id.toLowerCase() === emp.toLowerCase());
                            if (staff) {
                                const sLvl = (staff.level || '').toLowerCase();
                                const sRole = (staff.role || '').toLowerCase();
                                isGuard = sLvl.includes('guard') || sLvl.includes('รปภ') || sRole.includes('guard') || sRole.includes('รปภ');
                            }
                        }
                        
                        if (isGuard) {
                            workingCount++;
                        }
                    }
                }
                
                if (document.getElementById('workingCount')) {
                    document.getElementById('workingCount').innerText = workingCount;
                }
            } catch (err) {
                console.error('Error fetching working count:', err);
                if (document.getElementById('workingCount')) document.getElementById('workingCount').innerText = '0';
            }
        }

        async function fetchWeeklyStats() {
            try {
                const today = new Date();
                today.setHours(23, 59, 59, 999);
                const past7Days = new Date(today);
                past7Days.setDate(today.getDate() - 6);
                past7Days.setHours(0, 0, 0, 0);

                // Fetch logs for the past 7 days, ordered by timestamp descending and limited to 5000 rows
                const { data, error } = await supabaseClient
                    .from('duty_logs')
                    .select('emp_id, action_type, role, timestamp')
                    .gte('timestamp', past7Days.toISOString())
                    .lte('timestamp', today.toISOString())
                    .order('timestamp', { ascending: false })
                    .limit(5000);
                    
                if (error) throw error;

                // Helper to format date in Bangkok timezone (YYYY-MM-DD) robustly on all devices
                const getBangkokDateStr = (dateObj) => {
                    const localTime = new Date(dateObj.getTime() + 7 * 60 * 60 * 1000);
                    return localTime.toISOString().split('T')[0];
                };

                // Group by date string (YYYY-MM-DD) in Bangkok timezone
                const daysMap = {};
                for (let i=0; i<7; i++) {
                    const d = new Date(past7Days);
                    d.setDate(d.getDate() + i);
                    const dateStr = getBangkokDateStr(d);
                    const dayName = d.toLocaleDateString('th-TH', { weekday: 'short' });
                    daysMap[dateStr] = { label: dayName, count: 0 };
                }

                // Count check-in actions done by Supervisor/Manager levels for each day
                data.forEach(log => {
                    const logDate = new Date(log.timestamp);
                    const dateStr = getBangkokDateStr(logDate);
                    
                    if (daysMap[dateStr]) {
                        const action = (log.action_type || '').toLowerCase();
                        const role = (log.role || '').toLowerCase();
                        
                        const isCheckIn = action.includes('in') && !action.includes('leave') && !action.includes('out');
                        
                        let isSupervisor = role.includes('supervisor') || role.includes('manager');
                        // Fallback check against staffData
                        if (!isSupervisor && staffData.length > 0) {
                            const staff = staffData.find(s => s.id === log.emp_id);
                            if (staff) {
                                const sLvl = (staff.level || '').toLowerCase();
                                const sRole = (staff.role || '').toLowerCase();
                                isSupervisor = sLvl.includes('supervisor') || sLvl.includes('manager') || sRole.includes('supervisor') || sRole.includes('manager');
                            }
                        }
                        
                        if (isCheckIn && isSupervisor) {
                            daysMap[dateStr].count++;
                        }
                    }
                });

                const labels = [];
                const counts = [];
                Object.keys(daysMap).sort().forEach(dateStr => {
                    labels.push(daysMap[dateStr].label);
                    counts.push(daysMap[dateStr].count);
                });

                if (lineChart) {
                    lineChart.data.labels = labels;
                    lineChart.data.datasets[0].data = counts;
                    lineChart.data.datasets[0].label = 'จำนวนการเข้าตรวจ (ครั้ง)';
                    lineChart.update();
                }
            } catch (err) {
                console.error("Error fetching weekly stats", err);
            }
        }

        function renderLiveFeed(logs) {
            const container = document.getElementById('liveActivityFeed');
            if (!container) return;

            if (!logs || logs.length === 0) {
                container.innerHTML = '<p class="text-slate-500 text-xs py-10 text-center italic">ไม่มีกิจกรรมในขณะนี้</p>';
                return;
            }

            container.innerHTML = logs.map(log => {
                const timeObj = new Date(log.timestamp || log.created_at);
                const thaiDate = timeObj.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', year: '2-digit' });
                const time = timeObj.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
                
                const type = (log.action_type || '').toLowerCase();
                const isCheckIn = type.includes('in');
                const isLeave = type.includes('leave');
                
                const staffName = (log.name || 'ไม่ทราบชื่อ').split(' (')[0];
                const unitName = log.unit_name || 'ไม่ระบุหน่วยงาน';
                
                let statusColor = 'text-amber-500';
                let icon = 'fa-sign-in-alt';
                let label = 'เข้างาน/เข้าตรวจ';

                if (type.includes('out')) {
                    statusColor = 'text-emerald-500';
                    icon = 'fa-sign-out-alt';
                    label = 'ออกงาน/ออกตรวจ';
                } else if (isLeave) {
                    statusColor = 'text-blue-400';
                    icon = 'fa-calendar-minus';
                    label = 'บันทึกการลา';
                }

                return `
                    <div class="feed-item px-3 py-2 rounded-lg bg-slate-900/40 border border-white/5 hover:border-amber-500/30 transition-all flex items-center gap-2">
                        <span class="text-[10px] font-black ${statusColor} shrink-0" title="${label}"><i class="fas ${icon}"></i></span>
                        <span class="text-white text-[10px] font-bold whitespace-nowrap">${staffName} <span class="text-slate-500 font-normal text-[9px] ml-1">(${log.role || 'Staff'})</span></span>
                        <span class="text-slate-400 text-[9px] truncate flex-1">@ ${unitName}</span>
                        <span class="text-[9px] text-slate-500 font-mono shrink-0">${thaiDate} ${time}</span>
                    </div>
                `;
            }).join('');
        }

        // --- UI & Navigation ---
        function switchTab(tabId, el) {
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
            document.querySelectorAll('.submenu-item').forEach(s => s.classList.remove('active'));

            const target = document.getElementById(`tab-${tabId}`);
            if (target) target.classList.add('active');

            if (el) el.classList.add('active');

            // Only fetch if data is empty or specifically needed
            if (tabId === 'leaves' && (!filteredData || filteredData.length === 0)) fetchLeaves();
            if (tabId === 'finance') fetchFinance(); // Finance usually needs latest
            if (tabId === 'staff' && staffData.length === 0) fetchStaff();
            if (tabId === 'units' && unitsData.length === 0) fetchUnits();

            // Handle editing states cleanup
            if (tabId !== 'units') {
                editingUnitId = null;
                const btnUnitText = document.getElementById('btnUnitText');
                if (btnUnitText) btnUnitText.innerText = 'บันทึกหน่วยงาน';
                clearUnitForm();
            }

            // Close sidebar on mobile
            if (window.innerWidth <= 768) {
                const sidebar = document.querySelector('.sidebar');
                if (sidebar && sidebar.classList.contains('open')) toggleSidebar();
            }
            
            activeBulkTab = tabId;
            clearSelection();
        }

        // --- Staff Management ---
        async function fetchStaff() {
            try {
                let allData = [];
                let from = 0;
                let to = 999;
                let hasMore = true;

                // Loop fetch until all staff are loaded
                while (hasMore) {
                    const { data, error } = await supabaseClient
                        .from('staff')
                        .select('*')
                        .order('emp_id', { ascending: true })
                        .range(from, to);

                    if (error) throw error;
                    allData = [...allData, ...data];

                    if (data.length < 1000) {
                        hasMore = false;
                    } else {
                        from += 1000;
                        to += 1000;
                    }
                }

                staffData = allData.map(i => ({ 
                    id: i.emp_id, 
                    name: i.name, 
                    unit: i.unit, 
                    role: i.role, 
                    level: i.level, 
                    status: i.status, 
                    image: i.image, 
                    zone: i.zone,
                    password: i.password,
                    is_working: i.is_working,
                    vehicle_rate: i.vehicle_rate
                }));
                
                updateDashboardStats();
                checkStaffInactivity();
                fetchLiveActivity();

                // Recalculate guard count and supervisor stats now that staffData is fully loaded
                fetchWorkingGuardsCount();
                fetchWeeklyStats();
            } catch (error) {
                console.error("Staff Fetch Error:", error);
            }
        }

        async function checkStaffInactivity() {
            try {
                const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
                const { data: logs, error } = await supabaseClient
                    .from('duty_logs')
                    .select('emp_id, timestamp')
                    .gt('timestamp', fourteenDaysAgo)
                    .order('timestamp', { ascending: false });

                if (error) throw error;

                lastActiveMap = {}; // Update global map
                logs.forEach(log => {
                    if (!lastActiveMap[log.emp_id]) {
                        lastActiveMap[log.emp_id] = new Date(log.timestamp);
                    }
                });

                const now = new Date();
                const day3 = 3 * 24 * 60 * 60 * 1000;
                const day7 = 7 * 24 * 60 * 60 * 1000;

                let count3 = 0;
                let count7 = 0;

                staffData.forEach(s => {
                    if (s.status !== 'เปิด') return;
                    const lastDate = lastActiveMap[s.id];
                    if (!lastDate) return;
                    const diff = now - lastDate;
                    if (diff >= day7) count7++;
                    else if (diff >= day3) count3++;
                });

                if (count7 > 0) {
                    updateAIText(`บอสคะ! มีพนักงาน <b class="text-rose-500">${count7} นาย</b> ไม่ได้ออนไลน์เกิน <b>7 วัน</b> แล้วนะคะ ระบบแนะนำให้ลบข้อมูลออกค่ะ <br> <button onclick="showInactiveStaff(7)" class="mt-1 px-2 py-0.5 bg-rose-500/20 text-rose-400 rounded-md text-[9px] font-bold">ตรวจสอบคนหาย 7 วัน</button>`);
                } else if (count3 > 0) {
                    updateAIText(`สวัสดีค่ะบอส! พบพนักงาน <b class="text-amber-500">${count3} นาย</b> ไม่ได้เข้าสู่ระบบเกิน <b>3 วัน</b> แล้วค่ะ <br> <button onclick="showInactiveStaff(3)" class="mt-1 px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded-md text-[9px] font-bold">ดูรายละเอียด (3 วัน)</button>`);
                }
            } catch (err) { console.error("Inactivity Error:", err); }
        }

        function showInactiveStaff(days) {
            window.location.href = `ManageStaff.html?filter=inactive${days}`;
        }

        // --- Unit Management ---
        async function fetchUnits() {
            try {
                const { data, error } = await supabaseClient.from('units').select('*').order('unit_number', { ascending: true });
                if (error) throw error;
                unitsData = data || [];
                updateDashboardStats();
                updateUnitDropdowns();
            } catch (e) { console.error("Units Error:", e); }
        }

        function updateUnitDropdowns() {
            // 1. Populate Units Filter
            const fUnit = document.getElementById('hFilterUnit');
            if (fUnit) {
                const val = fUnit.value;
                const uniqueUnits = [...new Set(unitsData.map(u => u.unit_name))].sort();
                fUnit.innerHTML = '<option value="">ทั้งหมด</option>' + uniqueUnits.map(u => `<option value="${u}" ${u === val ? 'selected' : ''}>${u}</option>`).join('');
            }

            // 2. Populate Level Filter (Dynamic from data)
            const fLevel = document.getElementById('hFilterLevel');
            if (fLevel) {
                const val = fLevel.value;
                const uniqueLevels = [...new Set(staffData.map(s => s.level))].filter(Boolean).sort();
                fLevel.innerHTML = '<option value="">ทั้งหมด</option>' + uniqueLevels.map(l => `<option value="${l}" ${l === val ? 'selected' : ''}>${l}</option>`).join('');
            }

            // 3. Populate Zone Filter (Dynamic from data)
            const fZone = document.getElementById('hFilterZone');
            if (fZone) {
                const val = fZone.value;
                const uniqueZones = [...new Set(staffData.map(s => s.zone))].filter(Boolean).sort();
                fZone.innerHTML = '<option value="">ทั้งหมด</option>' + uniqueZones.map(z => `<option value="${z}" ${z === val ? 'selected' : ''}>${z}</option>`).join('');
            }

            // 4. Populate Status Filter (Dynamic from data)
            const fStatus = document.getElementById('hFilterStatus');
            if (fStatus) {
                const val = fStatus.value;
                const uniqueStatus = [...new Set(staffData.map(s => s.status))].filter(Boolean).sort();
                fStatus.innerHTML = '<option value="">ทั้งหมด</option>' + uniqueStatus.map(st => `<option value="${st}" ${st === val ? 'selected' : ''}>${st}</option>`).join('');
            }
        }

        function handleUnitInput(val) {
            const box = document.getElementById('unitSuggestions');
            if (!box) return;
            const matches = val ? unitsData.filter(u => u.unit_name.toLowerCase().includes(val.toLowerCase()) || u.unit_code.toLowerCase().includes(val.toLowerCase())) : unitsData;
            if (matches.length > 0) {
                box.innerHTML = matches.map(u => `<div class="suggestion-item" onclick="selectUnit('${u.unit_name}')"><div class="font-bold text-white text-[12px]">${u.unit_name}</div><div class="text-[10px] text-amber-500/80">${u.unit_code}</div><div class="text-[9px] text-slate-400">${u.zone}</div></div>`).join('');
                box.classList.remove('hidden');
            } else if (val) {
                box.innerHTML = '<div class="p-4 text-center text-slate-500 text-[11px]">ไม่พบข้อมูล</div>';
                box.classList.remove('hidden');
            } else { box.classList.add('hidden'); }
        }

        function selectUnit(name) { document.getElementById('empUnit').value = name; document.getElementById('unitSuggestions').classList.add('hidden'); }
        document.addEventListener('click', e => { if (!e.target.closest('#empUnit') && !e.target.closest('#unitSuggestions')) document.getElementById('unitSuggestions')?.classList.add('hidden'); });

        // --- Leaves Logic ---
        async function fetchLeaves() {
            try {
                const { data, error } = await supabaseClient.from('leaves').select('*, staff(name, role, image)').order('created_at', { ascending: false });
                if (error) throw error;
                const pending = data.filter(l => l.status === 'รออนุมัติ');
                const history = data.filter(l => l.status !== 'รออนุมัติ');
                
                document.getElementById('pendingCount').innerText = pending.length;
                renderPendingLeaves(pending);
                renderLeavesHistory(history);
            } catch (e) { console.error("Leaves Error:", e); }
        }

        function renderPendingLeaves(list) {
            const box = document.getElementById('pendingLeaves');
            if (list.length === 0) { box.innerHTML = '<div class="col-span-full p-8 text-center text-slate-500 bg-[#0f172a]/50 rounded-xl border border-dashed border-slate-800">ไม่มีรายการรออนุมัติ</div>'; return; }
            box.innerHTML = list.map(l => {
                // Calculate days if possible
                let daysText = '';
                if (l.start_date && l.end_date) {
                    const start = new Date(l.start_date);
                    const end = new Date(l.end_date);
                    const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
                    daysText = `(${diff} วัน)`;
                }

                return `
                <div class="data-card bg-[#1e293b]/40 border border-white/5 p-5">
                    <div class="flex gap-4 mb-4">
                        <img src="${getImageUrl(l.staff?.image, l.staff?.name)}" class="w-12 h-12 rounded-full border border-amber-500/30">
                        <div>
                            <h3 class="text-white font-bold">${l.staff?.name || 'Unknown'}</h3>
                            <p class="text-[10px] text-slate-400 uppercase tracking-wider">${l.staff?.role || 'Staff'}</p>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 gap-3 mb-4">
                        <div class="bg-[#0f172a]/50 p-2 rounded-lg border border-white/5">
                            <p class="text-[9px] text-slate-500 uppercase mb-1">ประเภทการลา</p>
                            <p class="text-xs text-amber-500 font-bold">${l.leave_type}</p>
                        </div>
                        <div class="bg-[#0f172a]/50 p-2 rounded-lg border border-white/5">
                            <p class="text-[9px] text-slate-500 uppercase mb-1">ระยะเวลาที่ลา ${daysText}</p>
                            <p class="text-[11px] text-slate-300 font-bold">${l.start_date} <i class="fas fa-arrow-right mx-1 text-slate-600"></i> ${l.end_date || l.start_date}</p>
                        </div>
                    </div>
                    <div class="mb-4 p-2 bg-amber-500/5 rounded-lg border border-amber-500/10">
                        <p class="text-[9px] text-amber-500/60 uppercase mb-1">เหตุผลการลา</p>
                        <p class="text-[11px] text-slate-300 leading-relaxed">${l.reason || '-'}</p>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="approveLeave('${l.id}')" class="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-bold transition-all shadow-lg shadow-emerald-600/10">อนุมัติ</button>
                        <button onclick="rejectLeave('${l.id}')" class="flex-1 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-500 rounded-lg text-[11px] font-bold transition-all">ไม่อนุมัติ</button>
                    </div>
                </div>
            `}).join('');
        }

        function renderLeavesHistory(list) {
            const body = document.getElementById('historyLeaves');
            body.innerHTML = list.slice(0, 10).map(l => `
                <tr class="hover:bg-slate-800/30 transition-colors">
                    <td class="px-4 py-3">
                        <p class="text-white font-bold">${l.staff?.name || 'Unknown'}</p>
                        <p class="text-[9px] text-slate-500">${l.leave_type}</p>
                    </td>
                    <td class="px-4 py-3 text-right">
                        <span class="px-2 py-0.5 rounded-[4px] text-[9px] font-bold ${l.status === 'อนุมัติ' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}">${l.status}</span>
                    </td>
                </tr>
            `).join('');
        }

        async function approveLeave(id) {
            if (!confirm('ยืนยันการอนุมัติการลา?')) return;
            try {
                const { error } = await supabaseClient.from('leaves').update({ status: 'อนุมัติ' }).eq('id', id);
                if (error) throw error;
                alert('อนุมัติการลาสำเร็จ');
                fetchLeaves();
            } catch (e) { alert("Error: " + e.message); }
        }

        async function rejectLeave(id) {
            const reason = prompt('ระบุเหตุผลที่ไม่อนุมัติ:');
            if (reason === null) return;
            try {
                const { error } = await supabaseClient.from('leaves').update({ status: 'ไม่อนุมัติ', reject_reason: reason }).eq('id', id);
                if (error) throw error;
                alert('ส่งคำขอคืนเรียบร้อย');
                fetchLeaves();
            } catch (e) { alert("Error: " + e.message); }
        }

        // --- Finance Logic ---
        async function fetchFinance() {
            try {
                const { data, error } = await supabaseClient.from('finance').select('*, staff(name)').order('created_at', { ascending: false });
                if (error) throw error;
                renderFinanceTable(data);
            } catch (e) { console.error("Finance Error:", e); }
        }

        function renderFinanceTable(list) {
            const body = document.getElementById('financeTableBody');
            if (!list || list.length === 0) { body.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-500">ไม่มีข้อมูลการเงิน</td></tr>'; return; }
            body.innerHTML = list.map(f => `
                <tr class="hover:bg-slate-800/30 transition-colors">
                    <td class="px-5 py-3">
                        <div class="flex flex-col">
                            <span class="text-white font-bold">${f.staff?.name || 'Unknown'}</span>
                            <span class="text-[9px] text-amber-500/70 font-bold uppercase tracking-wider">${f.staff?.unit || '-'}</span>
                        </div>
                    </td>
                    <td class="px-5 py-3">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${f.type === 'รายได้' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}">${f.type}</span>
                    </td>
                    <td class="px-5 py-3 font-mono text-white text-base">฿${f.amount?.toLocaleString() || 0}</td>
                    <td class="px-5 py-3 text-slate-400 text-[10px]">${new Date(f.created_at).toLocaleDateString('th-TH')}</td>
                    <td class="px-5 py-3">
                        <div class="max-w-[200px] truncate text-slate-500 italic text-[10px]" title="${f.description || '-'}">
                            ${f.description || '-'}
                        </div>
                    </td>
                    <td class="px-5 py-3 text-center">
                        <i class="fas fa-trash-alt cursor-pointer hover:text-red-500 transition-colors" onclick="deleteFinance('${f.id}')"></i>
                    </td>
                </tr>
            `).join('');
        }

        async function deleteFinance(id) {
            if (!confirm('ลบรายการการเงินนี้?')) return;
            try {
                const { error } = await supabaseClient.from('finance').delete().eq('id', id);
                if (error) throw error;
                alert('ลบรายการสำเร็จ');
                fetchFinance();
            } catch (e) { alert("Error: " + e.message); }
        }



