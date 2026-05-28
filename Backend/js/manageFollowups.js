/**
 * 🚨 NEXTGEN System Center - Tactical Follow-Up Command Controller
 * ควบคุมระบบติดตามพนักงานขาดการติดต่อ บัญชาการสายตรวจ และลงรายงานผลอัจฉริยะ
 */

(function () {
    // --- Supabase Client ---
    const supabaseClient = window.supabaseClient;

    // --- State Variables ---
    let staffData = [];
    let unitsData = [];
    let followupsData = [];
    let dutyLogsData = [];
    
    let lastActiveMap = {}; // emp_id -> Date
    let resolvedStaffList = []; // All calculated inactive staff
    let filteredStaffList = []; // After search & button filters
    
    let currentInactivityDaysFilter = 0; // 0 = all inactive, 3 = 3+ days, 7 = 7+ days
    let currentPage = 1;
    let itemsPerPage = 50;

    // --- Initialization ---
    document.addEventListener('DOMContentLoaded', async () => {
        // 1. ดึงข้อมูลผู้ใช้งานปัจจุบัน
        const userData = JSON.parse(localStorage.getItem('nextgen_user'));
        if (userData) {
            const userNameEl = document.getElementById('userName');
            const userLevelEl = document.getElementById('userLevel');
            if (userNameEl) userNameEl.innerText = userData.name || 'Admin';
            if (userLevelEl) userLevelEl.innerText = userData.level || 'Administrator';
            
            // ปรับแต่ง UI ตามบทบาท (Role-based UI Customization)
            if (userData.level === 'Supervisor') {
                const supCard = document.getElementById('supervisorAlertCard');
                const supZoneName = document.getElementById('supervisorZoneName');
                if (supCard) supCard.classList.remove('hidden');
                if (supZoneName) supZoneName.innerText = userData.zone || 'ไม่ระบุเขต';
            } else {
                const adminCard = document.getElementById('tacticalDispatchCard');
                if (adminCard) adminCard.classList.remove('hidden');
            }
        }

        // 2. เริ่มนาฬิกา
        startClock();

        // 3. โหลดฐานข้อมูลทั้งหมด
        await fetchFollowupRoom();
    });

    // --- Clock ---
    function startClock() {
        setInterval(() => {
            const clockEl = document.getElementById('digitalClock');
            if (clockEl) {
                const now = new Date();
                clockEl.innerText = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            }
        }, 1000);
    }

    // --- Fetch All Data from Supabase ---
    window.fetchFollowupRoom = async function() {
        const tableBody = document.getElementById('followupTable');
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="9" class="px-6 py-12 text-center text-slate-500 font-bold uppercase tracking-wider">
                        <i class="fas fa-satellite fa-spin text-amber-500 mb-2 text-xl block"></i> กำลังกวาดสัญญาณสแกนพนักงานทั้งหมด...
                    </td>
                </tr>
            `;
        }

        try {
            // 1. โหลดข้อมูลหน่วยงาน
            const { data: units, error: errUnits } = await supabaseClient
                .from('units')
                .select('*');
            if (errUnits) throw errUnits;
            unitsData = units || [];

            // 2. โหลดข้อมูลพนักงานที่เปิดใช้งาน (รองรับสถานะหลากหลายรูปแบบ)
            const { data: staff, error: errStaff } = await supabaseClient
                .from('staff')
                .select('*');
            if (errStaff) throw errStaff;
            staffData = (staff || []).filter(s => {
                const st = (s.status || '').toLowerCase().trim();
                return st === 'เปิด' || st === 'เปิดใช้งาน' || st === 'active' || st === 'on' || st === '';
            });

            // 3. โหลดข้อมูลใบงานติดตามตัว (ป้องกันข้อผิดพลาดกรณีผู้ใช้ยังไม่ได้รัน SQL Script ใน Supabase)
            let followups = [];
            window.isFollowupTableMissing = false;
            try {
                const { data, error: errFollowups } = await supabaseClient
                    .from('staff_followups')
                    .select('*');
                if (errFollowups) {
                    if (errFollowups.message.includes('staff_followups') || errFollowups.code === 'PGRST116') {
                        window.isFollowupTableMissing = true;
                    } else {
                        throw errFollowups;
                    }
                } else {
                    followups = data || [];
                }
            } catch (e) {
                console.warn("⚠️ ตาราง public.staff_followups ยังไม่ถูกสร้าง:", e);
                window.isFollowupTableMissing = true;
            }
            followupsData = followups;

            // 4. โหลดประวัติการสแกน 14 วันล่าสุด
            const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
            const { data: dutyLogs, error: errLogs } = await supabaseClient
                .from('duty_logs')
                .select('emp_id, timestamp')
                .gt('timestamp', fourteenDaysAgo)
                .order('timestamp', { ascending: false });
            if (errLogs) throw errLogs;
            dutyLogsData = dutyLogs || [];

            // ประมวลผลลัพธ์หาการออนไลน์ล่าสุด
            lastActiveMap = {};
            dutyLogsData.forEach(log => {
                if (!lastActiveMap[log.emp_id]) {
                    lastActiveMap[log.emp_id] = new Date(log.timestamp);
                }
            });

            // วิเคราะห์และสรุปหาผู้ขาดการติดต่อ (Analysis Engine)
            calculateInactivity();

        } catch (error) {
            console.error("Fetch Command Room Error:", error);
            if (tableBody) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="9" class="px-6 py-4 text-center text-red-500 font-bold">
                            ⚠️ เกิดข้อผิดพลาดในการโหลดข้อมูลห้องบัญชาการ: ${error.message}
                        </td>
                    </tr>
                `;
            }
        }
    }

    // --- Calculate Inactivity & Dynamic Zone Auto-fill Fallback ---
    function calculateInactivity() {
        const now = new Date();
        const threshold = 3 * 24 * 60 * 60 * 1000; // ขาดงานเกิน 3 วัน

        resolvedStaffList = [];

        staffData.forEach(s => {
            const lastActive = lastActiveMap[s.emp_id];
            
            // หาความต่างของเวลา
            const diff = lastActive ? (now - lastActive) : Infinity;
            
            // หากขาดการติดต่อเกิน 3 วันขึ้นไป (หรือเป็นพนักงานแล้วไม่สแกนเลย)
            if (diff >= threshold) {
                // 1. ค้นหาเขตตามสถาปัตยกรรม Dynamic Zone Auto-fill Fallback
                const unitObj = unitsData.find(u => u.unit_name === s.unit);
                const resolvedZone = (unitObj && unitObj.zone) || s.zone || 'ไม่ระบุเขต';

                // 2. ค้นหาความคืบหน้าของสายตรวจ
                const followup = followupsData.find(f => f.emp_id === s.emp_id);

                resolvedStaffList.push({
                    emp_id: s.emp_id,
                    name: s.name,
                    unit: s.unit || 'ยังไม่ได้ประจำหน่วย',
                    zone: resolvedZone,
                    lastActive: lastActive,
                    daysInactive: lastActive ? Math.floor(diff / (24 * 60 * 60 * 1000)) : Infinity,
                    followupStatus: followup ? followup.status : 'รอตรวจสอบ',
                    followupNotes: followup ? followup.notes : '',
                    followupUpdated: followup ? followup.updated_at : null
                });
            }
        });

        // ดักกรองข้อมูลตามบทบาทสิทธิ์ (Supervisor กรองเห็นเฉพาะเขตของตนเอง)
        const userData = JSON.parse(localStorage.getItem('nextgen_user'));
        if (userData && userData.level === 'Supervisor' && userData.zone) {
            resolvedStaffList = resolvedStaffList.filter(s => s.zone === userData.zone);
            
            // แสดงยอดการแจ้งเตือนสายตรวจด่วน
            const countEl = document.getElementById('supervisorInactiveCount');
            if (countEl) countEl.innerText = resolvedStaffList.length + " นาย";
        }

        // คำนวณยอดรวมรายสถิติ
        updateSummaryStats();

        // แสดงผลตารางหลัก
        applyFollowupFilters();
    }

    // --- Update Command Stats Cards ---
    function updateSummaryStats() {
        // ยอดขาดการติดต่อรวม
        document.getElementById('statTotalInactive').innerHTML = `${resolvedStaffList.length} <span class="text-[10px] text-slate-500 font-bold">นาย</span>`;

        // สรุปสถานะความคืบหน้าการทำงานสายตรวจ
        let countInvestigating = 0;
        let countDeviceIssues = 0;
        let countResigned = 0;
        let countCleared = 0;

        resolvedStaffList.forEach(s => {
            if (s.followupStatus === 'กำลังตรวจสอบ') countInvestigating++;
            else if (s.followupStatus === 'มือถือมีปัญหา') countDeviceIssues++;
            else if (s.followupStatus === 'ยืนยันลาออก') countResigned++;
            else if (s.followupStatus === 'ติดต่อได้แล้ว') countCleared++;
        });

        document.getElementById('statInvestigating').innerHTML = `${countInvestigating} <span class="text-[10px] text-slate-500 font-bold">นาย</span>`;
        document.getElementById('statDeviceIssues').innerHTML = `${countDeviceIssues} <span class="text-[10px] text-slate-500 font-bold">นาย</span>`;
        document.getElementById('statResigned').innerHTML = `${countResigned} <span class="text-[10px] text-slate-500 font-bold">นาย</span>`;
        document.getElementById('statCleared').innerHTML = `${countCleared} <span class="text-[10px] text-slate-500 font-bold">นาย</span>`;

        // บัญชีสรุปรายเขตสำหรับบอสใหญ่ (Owner Dynamic Zone Summary)
        const userData = JSON.parse(localStorage.getItem('nextgen_user'));
        if (userData && userData.level !== 'Supervisor') {
            const zoneCounts = {};
            resolvedStaffList.forEach(s => {
                zoneCounts[s.zone] = (zoneCounts[s.zone] || 0) + 1;
            });

            const zoneSummaryStr = Object.entries(zoneCounts)
                .map(([zone, count]) => `${zone}: <span class="text-white font-black">${count} นาย</span>`)
                .join(' | ') || 'ไม่มีผู้ขาดการติดต่อในขณะนี้ครับบอส!';
            
            const summaryEl = document.getElementById('inactiveZonesSummary');
            if (summaryEl) summaryEl.innerHTML = zoneSummaryStr;
        }

        // คำนวณคำพูด AI Mascot อัจฉริยะตามสถานการณ์จริง
        updateAIMascotAdvice(countResigned, countInvestigating);
    }

    // --- AI Mascot Operational Advice ---
    function updateAIMascotAdvice(resigned, investigating) {
        const bubble = document.getElementById('aiBubbleText');
        if (!bubble) return;

        if (window.isFollowupTableMissing) {
            bubble.innerHTML = `⚠️ <b>แจ้งเตือนบอส!</b> ตารางระบบติดตามพนักงาน (<span class="text-amber-500 font-mono">staff_followups</span>) ยังไม่ได้ถูกสร้างในฐานข้อมูล Supabase ค่ะ กรุณานำสคริปต์ในไฟล์ <b>create_followup_table.sql</b> ไปรันใน SQL Editor ของ Supabase เพื่อเปิดใช้งานการบันทึกรายงานแบบสมบูรณ์ค่ะ!`;
            return;
        }

        const total = resolvedStaffList.length;

        if (total === 0) {
            bubble.innerHTML = `สวัสดีค่ะบอส! ยอดเยี่ยมมากค่ะ ตอนนี้ <b>ไม่มีพนักงานขาดการติดต่อเลย</b> ทุกเขตปฏิบัติการเรียบร้อยดีค่ะ! 🛡️🟢`;
        } else if (resigned > 0) {
            bubble.innerHTML = `บอสคะ! สายตรวจยืนยันแล้วว่าพบ รปภ. <b class="text-rose-400 font-black">${resigned} นาย ยืนยันลาออก</b> แนะนำให้กดปุ่ม <b>"อนุมัติลบ"</b> ออกจากระบบ เพื่อเคลียร์สถิติให้สะอาดค่ะ 🧹⚠️`;
        } else if (total > 5) {
            bubble.innerHTML = `สวัสดีค่ะ! ตอนนี้พบคนขาดงานสะสมรวมสูงถึง <b class="text-amber-500 font-black">${total} นาย</b> แนะนำบอสกดปุ่ม <b>"⚡ ส่งใบสั่งงานสายตรวจด่วน"</b> เพื่อสั่งการสายตรวจลงพื้นที่สืบค้นทันทีค่ะ! 📡🚨`;
        } else {
            bubble.innerHTML = `สวัสดีค่ะบอส! พบพนักงานขาดงาน <b class="text-amber-500 font-black">${total} นาย</b> อยู่ระหว่างดำเนินการตรวจสอบพื้นที่อย่างใกล้ชิดค่ะ มีอะไรให้ช่วยแนะแนวบอกได้เลยนะคะ 👮📱`;
        }
    }

    // --- Filter Handlers ---
    window.changeInactivityFilter = function(days) {
        currentInactivityDaysFilter = days;

        // อัปเดตสีปุ่มไฮไลท์
        ['btnFilter3', 'btnFilter7', 'btnFilterAll'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.className = "px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-[10px] font-black uppercase text-slate-400 hover:text-white transition-all";
            }
        });

        const activeId = days === 3 ? 'btnFilter3' : (days === 7 ? 'btnFilter7' : 'btnFilterAll');
        const activeBtn = document.getElementById(activeId);
        if (activeBtn) {
            activeBtn.className = "px-3.5 py-2 rounded-xl bg-amber-500 text-black border border-amber-500/30 text-[10px] font-black uppercase transition-all shadow-md shadow-amber-500/10";
        }

        currentPage = 1;
        applyFollowupFilters();
    }

    window.applyFollowupFilters = function() {
        const query = document.getElementById('followupSearchInput').value.toLowerCase().trim();

        filteredStaffList = resolvedStaffList.filter(s => {
            // 1. กรองตามปุ่มวัน
            if (currentInactivityDaysFilter === 3 && s.daysInactive < 3) return false;
            if (currentInactivityDaysFilter === 7 && s.daysInactive < 7) return false;

            // 2. กรองตามคำค้นหา
            if (query) {
                const matchId = s.emp_id.toLowerCase().includes(query);
                const matchName = s.name.toLowerCase().includes(query);
                const matchUnit = s.unit.toLowerCase().includes(query);
                const matchZone = s.zone.toLowerCase().includes(query);
                const matchStatus = s.followupStatus.toLowerCase().includes(query);
                return matchId || matchName || matchUnit || matchZone || matchStatus;
            }

            return true;
        });

        // เรียงลำดับคนหายจากวันมากไปหาน้อย
        filteredStaffList.sort((a, b) => b.daysInactive - a.daysInactive);

        currentPage = 1;
        renderFollowupTable();
    }

    // --- Render Table ---
    function renderFollowupTable() {
        const tableBody = document.getElementById('followupTable');
        if (!tableBody) return;

        if (filteredStaffList.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="9" class="px-6 py-12 text-center text-slate-500 font-bold uppercase tracking-wider">
                        📂 ไม่พบรายชื่อพนักงานที่ขาดการติดต่อตามเงื่อนไขที่กำหนด
                    </td>
                </tr>
            `;
            updatePagination(0);
            return;
        }

        const startIdx = (currentPage - 1) * itemsPerPage;
        const endIdx = startIdx + itemsPerPage;
        const pageItems = filteredStaffList.slice(startIdx, endIdx);

        const userData = JSON.parse(localStorage.getItem('nextgen_user'));
        const isSup = userData && userData.level === 'Supervisor';

        tableBody.innerHTML = pageItems.map((s, index) => {
            // ตัวแทนความถี่ล่าสุด
            let frequencyStr = '';
            if (s.daysInactive === Infinity) {
                frequencyStr = `<span class="text-rose-500 font-black animate-pulse">⚠️ ไม่เคยสแกนเลย</span><br><span class="text-[9px] text-slate-500 font-semibold">(รปภ. ใหม่/ยังไม่ทำงาน)</span>`;
            } else {
                frequencyStr = `<span class="text-amber-500 font-black font-mono">${s.daysInactive} วัน</span><br><span class="text-[9px] text-slate-500 font-semibold">(สแกนครั้งสุดท้าย ${s.lastActive.toLocaleDateString('th-TH')})</span>`;
            }

            // ตกแต่งป้ายแสดงสถานะ
            let statusBadge = '';
            let pulseClass = '';
            let badgeColor = 'bg-rose-500/20 text-rose-400 border-rose-500/30';
            let dotGlowClass = 'bg-slate-400';

            if (s.followupStatus === 'รอตรวจสอบ') {
                badgeColor = 'bg-slate-800 text-slate-400 border-slate-700';
                pulseClass = 'animate-pulse';
                dotGlowClass = 'bg-slate-400 shadow-[0_0_8px_#94a3b8]';
            } else if (s.followupStatus === 'กำลังตรวจสอบ') {
                badgeColor = 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
                pulseClass = 'animate-pulse';
                dotGlowClass = 'bg-yellow-400 shadow-[0_0_10px_#facc15]';
            } else if (s.followupStatus === 'มือถือมีปัญหา') {
                badgeColor = 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
                dotGlowClass = 'bg-cyan-400 shadow-[0_0_10px_#22d3ee] animate-pulse';
            } else if (s.followupStatus === 'ยืนยันลาออก') {
                badgeColor = 'bg-red-600/30 text-red-500 border-red-500/50';
                pulseClass = 'animate-pulse';
                dotGlowClass = 'bg-rose-500 shadow-[0_0_12px_#f43f5e] animate-ping';
            } else if (s.followupStatus === 'ติดต่อได้แล้ว') {
                badgeColor = 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
                dotGlowClass = 'bg-emerald-400 shadow-[0_0_10px_#34d399]';
            }

            statusBadge = `
                <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-black border uppercase tracking-wider ${badgeColor} ${pulseClass}">
                    <span class="w-1.5 h-1.5 rounded-full ${dotGlowClass}"></span>
                    ${s.followupStatus}
                </span>
            `;

            // ปุ่มแก้ไขและลบ ทุกแถว
            const isResigned = s.followupStatus === 'ยืนยันลาออก';
            const isCleared  = s.followupStatus === 'ติดต่อได้แล้ว';
            let actionButtons = '';

            if (isSup) {
                // สายตรวจ: ปุ่มแก้ไข (บันทึกรายงาน) + ลบ
                actionButtons = `
                    <div class="flex items-center gap-1">
                        <button onclick="openSupervisorModal('${s.emp_id}', '${s.name.replace(/'/g, "\\'")}')"
                            class="flex-1 py-1 rounded bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500 hover:text-black transition-all flex items-center justify-center gap-1 border border-cyan-500/20 text-[9px] font-black h-7 active:scale-95 duration-150"
                            title="แก้ไขและบันทึกรายงานผล">
                            <i class="fas fa-edit text-[8px]"></i> แก้ไข
                        </button>
                        <button onclick="deleteStaff('${s.emp_id}')"
                            class="flex-1 py-1 rounded bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-all flex items-center justify-center gap-1 border border-rose-500/20 text-[9px] font-black h-7 active:scale-95 duration-150"
                            title="ลบพนักงานออกจากระบบ">
                            <i class="fas fa-trash-alt text-[8px]"></i> ลบ
                        </button>
                    </div>
                `;
            } else {
                // Owner/Admin/Manager: ปุ่มแก้ไข + ลบ ทุกแถวเสมอ
                actionButtons = `
                    <div class="flex flex-col gap-1">
                        <div class="flex items-center gap-1">
                            <button onclick="openSupervisorModal('${s.emp_id}', '${s.name.replace(/'/g, "\\'")}')"
                                class="flex-1 py-1 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500 hover:text-black transition-all flex items-center justify-center gap-1 border border-amber-500/20 text-[9px] font-black h-7 active:scale-95 duration-150"
                                title="แก้ไขสถานะและบันทึกรายงาน">
                                <i class="fas fa-edit text-[8px]"></i> แก้ไข
                            </button>
                            <button onclick="deleteStaff('${s.emp_id}')"
                                class="flex-1 py-1 rounded ${isResigned ? 'bg-red-600 hover:bg-red-700 text-white border-red-500 animate-pulse' : 'bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white border-rose-500/20'} transition-all flex items-center justify-center gap-1 border text-[9px] font-black h-7 active:scale-95 duration-150"
                                title="${isResigned ? 'อนุมัติลบพนักงานขาดงานออกจากสารบบ' : 'ลบพนักงานออกจากระบบ'}">
                                <i class="fas fa-${isResigned ? 'check-double' : 'trash-alt'} text-[8px]"></i> ลบ
                            </button>
                        </div>
                        ${isCleared ? '<button onclick="clearFollowup(\'' + s.emp_id + '\')" class="w-full py-0.5 rounded bg-emerald-500/10 hover:bg-emerald-500 hover:text-black text-emerald-400 text-[8px] font-black transition-all flex items-center justify-center gap-1 border border-emerald-500/20 h-5" title="เคลียร์สถานะติดตามตัวกลับเป็นปกติ"><i class="fas fa-undo text-[7px]"></i> เคลียร์งาน</button>' : ''}
                    </div>
                `;
            }

            return `
                <tr class="hover:bg-slate-800/30 transition-colors group">
                    <td class="px-3 py-2 text-center text-slate-500 font-mono text-[10px]">${startIdx + index + 1}</td>
                    <td class="px-3 py-2 font-mono text-amber-500 font-bold">${s.emp_id}</td>
                    <td class="px-3 py-2 font-bold text-white">${s.name}</td>
                    <td class="px-3 py-2 text-slate-300">${s.unit}</td>
                    <td class="px-3 py-2 text-slate-300 font-black text-[11px]">${s.zone}</td>
                    <td class="px-3 py-2">${frequencyStr}</td>
                    <td class="px-3 py-2 text-center">${statusBadge}</td>
                    <td class="px-3 py-2">
                        <p class="text-slate-300 font-medium line-clamp-2">${s.followupNotes || '<span class="text-slate-600 italic">-- ไม่มีรายงานข้อมูลเพิ่มเติม --</span>'}</p>
                        ${s.followupUpdated ? '<span class="text-[8px] text-slate-500 font-bold uppercase mt-0.5 block">อัปเดต: ' + new Date(s.followupUpdated).toLocaleTimeString('th-TH') + ' - ' + new Date(s.followupUpdated).toLocaleDateString('th-TH') + '</span>' : ''}
                    </td>
                    <td class="px-3 py-2">
                        ${actionButtons}
                    </td>
                </tr>
            `;
        }).join('');

        updatePagination(filteredStaffList.length);
    }

    // --- Pagination Mechanics ---

    function updatePagination(totalItems) {
        const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
        const start = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
        const end = Math.min(currentPage * itemsPerPage, totalItems);

        document.getElementById('pageStartItem').innerText = start;
        document.getElementById('pageEndItem').innerText = end;
        document.getElementById('totalItems').innerText = totalItems;

        const pageNumEl = document.getElementById('pageNumbers');
        if (pageNumEl) {
            let html = '';
            for (let i = 1; i <= totalPages; i++) {
                const active = i === currentPage ? 'bg-amber-500 text-black' : 'bg-[#0f172a] text-slate-400';
                html += `<button onclick="goToPage(${i})" class="w-6 h-6 rounded font-bold text-[10px] ${active} border border-slate-800">${i}</button>`;
            }
            pageNumEl.innerHTML = html;
        }

        const jumpEl = document.getElementById('jumpSelect');
        if (jumpEl) {
            jumpEl.innerHTML = Array.from({ length: totalPages }, (_, i) => `<option value="${i + 1}" ${i + 1 === currentPage ? 'selected' : ''}>หน้า ${i + 1}</option>`).join('');
        }
    }

    window.goToPage = function(p) { currentPage = parseInt(p); renderFollowupTable(); }
    window.nextPage = function() { if (currentPage < Math.ceil(filteredStaffList.length / itemsPerPage)) { currentPage++; renderFollowupTable(); } }
    window.prevPage = function() { if (currentPage > 1) { currentPage--; renderFollowupTable(); } }

    // --- Send Inactive Followup Dispatch (Admin) ---
    window.dispatchFollowUpTasks = async function() {
        if (window.isFollowupTableMissing) {
            return alert("⚠️ ไม่สามารถส่งใบงานได้เนื่องจากยังไม่ได้สร้างตาราง 'staff_followups' บนฐานข้อมูล Supabase ครับบอส! กรุณานำสคริปต์ในไฟล์ 'create_followup_table.sql' ไปรันในช่อง SQL Editor ก่อนนะครับ");
        }

        if (filteredStaffList.length === 0) {
            return alert("ไม่มีพนักงานที่ขาดการติดต่อในขณะนี้ครับบอส!");
        }

        if (!confirm(`ยืนยันการส่งใบสั่งงานสายตรวจด่วนตามเขตพื้นที่ของ รปภ. ทั้งหมด ${filteredStaffList.length} นาย ใช่หรือไม่ครับบอส?`)) {
            return;
        }

        // จัดเตรียมข้อมูลส่งเข้าตาราง staff_followups
        const tasks = filteredStaffList.map(s => {
            return {
                emp_id: s.emp_id,
                zone: s.zone,
                status: 'รอตรวจสอบ',
                notes: s.followupNotes || 'ส่งใบงานติดตามด่วนโดยเจ้าของระบบ',
                updated_at: new Date().toISOString()
            };
        });

        try {
            // ใช้ upsert เพื่ออัปเดตใบสั่งงานหากมีอยู่แล้ว หรือเพิ่มอันใหม่
            const { error } = await supabaseClient
                .from('staff_followups')
                .upsert(tasks, { onConflict: 'emp_id' });

            if (error) throw error;

            alert(`⚡ ส่งใบสั่งงานสายตรวจด่วนสำเร็จ! ระบบแยกใบงานและกระจายส่งหาผู้ดูแลเขตเรียบร้อยครับบอส!`);
            
            // โหลดข้อมูลความคืบหน้าใหม่
            await fetchFollowupRoom();
        } catch (e) {
            console.error("Dispatch Tasks Error:", e);
            alert("ไม่สามารถส่งใบสั่งงานได้: " + (e.message || "กรุณาตรวจสอบโครงสร้างตารางข้อมูล"));
        }
    }

    // --- Clear Followup Task (Set back to active status) ---
    window.clearFollowup = async function(empId) {
        if (window.isFollowupTableMissing) {
            return alert("⚠️ ไม่สามารถเคลียร์ใบงานได้เนื่องจากยังไม่ได้สร้างตาราง 'staff_followups' บนฐานข้อมูล Supabase ครับบอส! กรุณานำสคริปต์ในไฟล์ 'create_followup_table.sql' ไปรันในช่อง SQL Editor ก่อนนะครับ");
        }
        if (!confirm(`ต้องการเคลียร์สถานะติดตามตัวของพนักงานรหัส ${empId} กลับเป็นปกติใช่หรือไม่ครับบอส?`)) return;
        try {
            const { error } = await supabaseClient
                .from('staff_followups')
                .delete()
                .eq('emp_id', empId);

            if (error) throw error;
            alert("เคลียร์ใบสั่งงานและคืนสถานะเป็นปกติสำเร็จครับบอส!");
            await fetchFollowupRoom();
        } catch (e) {
            console.error("Clear Followup Error:", e);
            alert("ไม่สามารถเคลียร์ใบงานได้: " + e.message);
        }
    }

    // --- Delete Staff (Owner/Manager level) ---
    window.deleteStaff = async function(id) {
        const currentUser = JSON.parse(localStorage.getItem('nextgen_user'));

        // ป้องกันลบตัวเอง
        if (id === currentUser.emp_id) {
            return alert('⚠️ บอสครับ! ลบตัวเองออกจากระบบไม่ได้นะครับ!');
        }

        if (!confirm(`⚠️ ยืนยันที่จะลบ รปภ. รหัส ${id} ออกจากสารบบพนักงานหลัก ใช่หรือไม่? ข้อมูลนี้จะถูกลบอย่างถาวร บอสตัดสินใจดีแล้วนะครับ`)) return;

        try {
            // 1. ลบจากตารางพนักงาน
            const { error: errStaff } = await supabaseClient
                .from('staff')
                .delete()
                .eq('emp_id', id);
            if (errStaff) throw errStaff;

            // 2. ลบจากใบงานค้างคา (ถ้ามี)
            try {
                if (!window.isFollowupTableMissing) {
                    await supabaseClient
                        .from('staff_followups')
                        .delete()
                        .eq('emp_id', id);
                }
            } catch (errFollowup) {
                console.warn("Followup deletion warning:", errFollowup);
            }

            alert(`🧹 กำจัดข้อมูลและรหัส รปภ. ${id} ออกจากประวัติองค์กรเรียบร้อยครับบอส!`);
            await fetchFollowupRoom();
        } catch (e) {
            console.error("Delete Staff Error:", e);
            alert("ไม่สามารถลบข้อมูลพนักงานได้: " + e.message);
        }
    }

    // --- Supervisor Report Modal Functions ---
    window.openSupervisorModal = function(empId, empName) {
        const modal = document.getElementById('supervisorReportModal');
        if (!modal) return;

        // บันทึกรายละเอียดลงบนหัว
        document.getElementById('repEmpInfo').innerText = `${empId} (${empName})`;
        
        // ตรวจหาข้อมูลความคืบหน้าล่าสุด
        const followup = followupsData.find(f => f.emp_id === empId);
        if (followup) {
            document.getElementById('repStatus').value = followup.status || 'กำลังตรวจสอบ';
            document.getElementById('repNotes').value = followup.notes || '';
        } else {
            document.getElementById('repStatus').value = 'กำลังตรวจสอบ';
            document.getElementById('repNotes').value = '';
        }

        // เก็บ empId ไว้ใน Modal dataset
        modal.dataset.empId = empId;
        modal.classList.remove('hidden');
    }

    window.closeSupervisorModal = function() {
        const modal = document.getElementById('supervisorReportModal');
        if (modal) modal.classList.add('hidden');
    }

    window.saveSupervisorReport = async function() {
        if (window.isFollowupTableMissing) {
            return alert("⚠️ ไม่สามารถบันทึกรายงานได้เนื่องจากยังไม่ได้สร้างตาราง 'staff_followups' บนฐานข้อมูล Supabase ครับบอส! กรุณานำสคริปต์ในไฟล์ 'create_followup_table.sql' ไปรันในช่อง SQL Editor ก่อนนะครับ");
        }
        const modal = document.getElementById('supervisorReportModal');
        if (!modal) return;

        const empId = modal.dataset.empId;
        const status = document.getElementById('repStatus').value;
        const notes = document.getElementById('repNotes').value.trim();

        if (!empId) return;

        try {
            // ค้นหาข้อมูลพนักงานเดิม
            const s = resolvedStaffList.find(x => x.emp_id === empId);
            const zone = s ? s.zone : 'ไม่ระบุเขต';

            // อัปเดตข้อมูลขึ้น Supabase
            const { error } = await supabaseClient
                .from('staff_followups')
                .upsert({
                    emp_id: empId,
                    zone: zone,
                    status: status,
                    notes: notes,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'emp_id' });

            if (error) throw error;

            alert("⚡ บันทึกรายงานการติดตามพนักงานเรียบร้อยครับ!");
            closeSupervisorModal();
            await fetchFollowupRoom();
        } catch (e) {
            console.error("Save Report Error:", e);
            alert("ไม่สามารถบันทึกรายงานได้: " + e.message);
        }
    }

})();
