/**
 * 🛡️ NEXTGEN System Center - Staff Management Controller
 * ควบคุมระบบพนักงานแบบเรียลไทม์ เชื่อมโยงกับฐานข้อมูล Supabase
 */

(function () {
    // --- State ---
    let staffData = [];
    let unitsData = [];
    let editingEmpId = null;
    let currentPage = 1;
    let itemsPerPage = 50; // Initial load, increases on scroll/pagination
    let filteredData = [];
    let lastActiveMap = {}; // Global storage for inactivity check
    let selectedItems = new Set();
    let isRendering = false;
    let followupsData = [];

    // --- Initialization ---
    document.addEventListener('DOMContentLoaded', async () => {
        // 1. ดึงสิทธิ์ผู้ใช้งานแสดงผล
        const userData = JSON.parse(localStorage.getItem('nextgen_user'));
        if (userData) {
            const userNameEl = document.getElementById('userName');
            const userLevelEl = document.getElementById('userLevel');
            if (userNameEl) userNameEl.innerText = userData.name || 'Admin';
            if (userLevelEl) userLevelEl.innerText = userData.level || 'Administrator';
        }

        // 2. เริ่มนาฬิกา
        startClock();

        // 3. โหลดข้อมูลน้ำมัน และข้อมูลพนักงาน/หน่วยงาน
        await loadFuelRates();
        await fetchUnits();
        await fetchStaff();
        checkInactiveStaffForMascot();



        // 5. ยกเลิก Infinite Scroll เพื่อเปลี่ยนมาใช้ Pagination ควบคุมหน้าตารางแบบเด็ดขาด
        // setupInfiniteScroll();

        // 6. ดักจับการเปลี่ยนแปลงเลเวลพนักงานเพื่อซ่อน/แสดงกลุ่มยานพาหนะและเรทน้ำมัน
        const empLevelEl = document.getElementById('empLevel');
        if (empLevelEl) {
            empLevelEl.addEventListener('change', toggleVehicleRateVisibility);
        }
        toggleVehicleRateVisibility();
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

    // --- Toggle Vehicle Rate Selector Visibility based on User Level ---
    function toggleVehicleRateVisibility() {
        const levelSelect = document.getElementById('empLevel');
        const vehicleGroup = document.getElementById('vehicleRateGroup');
        if (levelSelect && vehicleGroup) {
            if (levelSelect.value === 'Guard') {
                vehicleGroup.style.display = 'none';
            } else {
                vehicleGroup.style.display = 'block';
            }
        }
    }



    // --- Setup Infinite Scroll ---
    function setupInfiniteScroll() {
        const container = document.getElementById('staffTableContainer');
        if (container) {
            container.addEventListener('scroll', function () {
                if (isRendering) return;
                const { scrollTop, scrollHeight, clientHeight } = this;
                if (scrollTop + clientHeight >= scrollHeight - 20) {
                    if (currentPage * itemsPerPage < filteredData.length) {
                        currentPage++;
                        renderTable();
                    }
                }
            });
        }
    }

    // --- Fetch Staff Data from Supabase ---
    window.fetchStaff = async function() {
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

            applyFilter();
            updateUnitDropdowns();
        } catch (error) {
            console.error("Staff Fetch Error:", error);
        }
     }

    // --- Dynamic AI Mascot Advice for Inactive Staff ---
    async function checkInactiveStaffForMascot() {
        try {
            const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
            
            // ดึงประวัติการสแกน 3 วันล่าสุด
            const { data: logs, error } = await supabaseClient
                .from('duty_logs')
                .select('emp_id, timestamp')
                .gt('timestamp', threeDaysAgo);
                
            if (error) throw error;
            
            const activeScanners = new Set((logs || []).map(l => l.emp_id));
            
            // กรองหาพนักงานที่ "เปิด" แต่ไม่มีประวัติสแกนในช่วง 3 วันนี้
            const inactiveStaff = staffData.filter(s => {
                const st = (s.status || '').toLowerCase().trim();
                const isActive = st === 'เปิด' || st === 'เปิดใช้งาน' || st === 'active' || st === 'on' || st === '';
                return isActive && !activeScanners.has(s.id);
            });
            
            if (inactiveStaff.length > 0) {
                const bubble = document.getElementById('aiBubbleText');
                if (bubble) {
                    bubble.innerHTML = `บอสคะ! ระบบวิเคราะห์พบพนักงานขาดการสแกน 3 วันขึ้นไปรวม <b class="text-amber-500 font-black">${inactiveStaff.length} นาย</b> แนะนำเปิดศูนย์ติดตามตัวด่วนค่ะ!<br><button onclick="window.location.href='ManageFollowups.html'" class="mt-2 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-[10px] font-black uppercase tracking-wider transition-all block w-full text-center shadow-lg shadow-amber-500/20 animate-pulse">🚨 เปิดศูนย์ติดตามตัว</button>`;
                }
            }
        } catch (err) {
            console.warn("Mascot inactivity check warning:", err);
        }
    }

    // --- Fetch Units Data from Supabase ---
    async function fetchUnits() {
        try {
            const { data, error } = await supabaseClient.from('units').select('*').order('unit_number', { ascending: true });
            if (error) throw error;
            unitsData = data || [];
        } catch (e) {
            console.error("Units Error:", e);
        }
    }

    // --- Dropdowns Populator ---
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

    // --- Search & Filters Engine ---
    let filterTimeout;
    window.applyFilter = function() {
        clearTimeout(filterTimeout);
        filterTimeout = setTimeout(() => {
            const global = (document.getElementById('globalStaffSearch')?.value || '').toLowerCase().trim();
            const filters = {
                id: (document.getElementById('hFilterId')?.value || '').toLowerCase().trim(),
                name: (document.getElementById('hFilterName')?.value || '').toLowerCase().trim(),
                unit: (document.getElementById('hFilterUnit')?.value || '').trim(),
                role: (document.getElementById('hFilterRole')?.value || '').toLowerCase().trim(),
                level: (document.getElementById('hFilterLevel')?.value || '').trim(),
                status: (document.getElementById('hFilterStatus')?.value || '').trim(),
                zone: (document.getElementById('hFilterZone')?.value || '').trim(),
                vehicle: (document.getElementById('hFilterVehicle')?.value || '').trim()
            };

            filteredData = staffData.filter(s => {
                const sId = (s.id || '').toLowerCase();
                const sName = (s.name || '').toLowerCase();
                const sRole = (s.role || '').toLowerCase();
                const sUnit = (s.unit || '');
                const sZone = (s.zone || '');
                const sLevel = (s.level || '');
                const sStatus = (s.status || '');

                const matchGlobal = !global ||
                    sId.includes(global) ||
                    sName.includes(global) ||
                    sRole.includes(global) ||
                    sUnit.toLowerCase().includes(global) ||
                    sZone.toLowerCase().includes(global) ||
                    sLevel.toLowerCase().includes(global) ||
                    sStatus.toLowerCase().includes(global);

                const matchFields =
                    (filters.id ? sId.includes(filters.id) : true) &&
                    (filters.name ? sName.includes(filters.name) : true) &&
                    (filters.unit ? sUnit === filters.unit : true) &&
                    (filters.role ? sRole.includes(filters.role) : true) &&
                    (filters.level ? sLevel === filters.level : true) &&
                    (filters.status ? sStatus === filters.status : true) &&
                    (filters.zone ? sZone === filters.zone : true) &&
                    (filters.vehicle ? parseFloat(s.vehicle_rate) === parseFloat(filters.vehicle) : true);

                return matchGlobal && matchFields;
            });
            // ซ่อนการ์ดคำสั่งคนหายเมื่อมีการกรองหรือค้นหาข้อมูลอื่น
            const commandCard = document.getElementById('inactiveStaffCommandCard');
            if (commandCard) commandCard.classList.add('hidden');

            currentPage = 1;
            const container = document.getElementById('staffTableContainer');
            if (container) container.scrollTop = 0;
            clearSelection();
            renderTable();
        }, 300);
    }

    // --- Render Table HTML ---
    window.renderTable = function() {
        if (isRendering) return;
        isRendering = true;

        const body = document.getElementById('staffTable');
        if (!body) { isRendering = false; return; }

        const start = (currentPage - 1) * itemsPerPage;
        const end = currentPage * itemsPerPage;
        const data = filteredData.slice(start, end);

        body.innerHTML = data.map((s, index) => {
            // ค้นหาเขตจาก unitsData
            const unitObj = unitsData.find(u => u.unit_name === s.unit);
            const resolvedZone = (unitObj && unitObj.zone) || s.zone || '-';

            const actionButtons = `
                <button onclick="editStaff('${s.id}')" class="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-500 hover:bg-amber-500 hover:text-black transition-all flex items-center justify-center border border-amber-500/20 shadow-sm" title="แก้ไข">
                    <i class="fas fa-edit text-[10px]"></i>
                </button>
                <button onclick="deleteStaff('${s.id}')" class="w-7 h-7 rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-all flex items-center justify-center border border-rose-500/20 shadow-sm" title="ลบ">
                    <i class="fas fa-trash-alt text-[10px]"></i>
                </button>
            `;

            return `
            <tr class="hover:bg-slate-800/30 transition-colors group ${selectedItems.has(s.id) ? 'bg-amber-500/10' : ''}">
                <td class="px-3 py-2 text-center">
                    <input type="checkbox" onclick="toggleSingleSelection('${s.id}')" ${selectedItems.has(s.id) ? 'checked' : ''} class="row-checkbox w-3.5 h-3.5 rounded border-slate-700 bg-[#020617] text-amber-500 focus:ring-amber-500/50 cursor-pointer">
                </td>
                <td class="px-3 py-2 text-center text-slate-500 font-mono text-[10px]">${start + index + 1}</td>
                <td class="px-3 py-2 font-mono text-amber-500 font-bold">
                    ${s.id}
                </td>
                <td class="px-3 py-2">
                    <div class="flex items-center gap-2 group/pass">
                        <div class="relative overflow-hidden px-2 py-1 rounded bg-[#0f172a] border border-amber-500/20 shadow-inner cursor-pointer hover:border-amber-500/50 transition-all"
                             onclick="toggleRowPassword('${s.id}', '${s.password || '----'}')">
                            <span class="password-text font-mono text-[10px] text-amber-500/30 filter blur-[3px] transition-all duration-300" 
                                  id="pass-${s.id}">
                                ${s.password || '----'}
                            </span>
                            <div id="overlay-${s.id}" class="absolute inset-0 flex items-center justify-center bg-[#0f172a]/80">
                                <i class="fas fa-lock text-[8px] text-amber-500/40"></i>
                            </div>
                        </div>
                    </div>
                </td>
                <td class="px-3 py-2 font-bold text-white">${(s.name || '').split(' (')[0]}</td>
                <td class="px-3 py-2 text-slate-300">${s.unit}</td>
                <td class="px-3 py-2 text-slate-400">${s.role}</td>
                <td class="px-3 py-2 text-slate-300">${s.level}</td>
                <td class="px-3 py-2 text-slate-300 font-bold">${resolvedZone}</td>
                <td class="px-3 py-2">
                    <span class="px-2 py-0.5 rounded text-[9px] font-bold ${s.status === 'เปิด' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-500'}">
                        ${s.status}
                    </span>
                </td>
                <td class="px-3 py-2">
                    ${s.level === 'Guard' ? `
                        <span class="text-slate-600 font-bold font-mono">-</span>
                    ` : `
                        <span class="px-2 py-0.5 rounded text-[10px] font-black bg-amber-500/10 text-amber-500 border border-amber-500/20">
                            ${parseFloat(s.vehicle_rate) === 3.0 ? `🏍️ ${parseFloat(fuelRates.motorcycle).toFixed(1)}` : parseFloat(s.vehicle_rate) === 4.5 ? `🚛 ${parseFloat(fuelRates.diesel).toFixed(1)}` : parseFloat(s.vehicle_rate) === 5.0 ? `🚗 ${parseFloat(fuelRates.gasoline).toFixed(1)}` : `🚗 ${parseFloat(s.vehicle_rate).toFixed(1)}`}
                        </span>
                    `}
                </td>
                <td class="px-3 py-2">
                    <div class="flex items-center justify-center gap-2">
                        ${actionButtons}
                    </div>
                </td>
            </tr>`;
        }).join('');

        updateBulkUI();
        renderPagination();
        isRendering = false;
    }

    // --- Pagination Render ---
    function renderPagination() {
        const totalItems = filteredData.length;
        const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
        const start = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
        const end = Math.min(currentPage * itemsPerPage, totalItems);

        const startEl = document.getElementById('pageStartItem');
        const endEl = document.getElementById('pageEndItem');
        const totalEl = document.getElementById('totalItems');
        const pageNumEl = document.getElementById('pageNumbers');
        const jumpEl = document.getElementById('jumpSelect');

        if (startEl) startEl.innerText = start.toLocaleString('th-TH');
        if (endEl) endEl.innerText = end.toLocaleString('th-TH');
        if (totalEl) totalEl.innerText = totalItems.toLocaleString('th-TH');

        if (pageNumEl) {
            let html = '';
            const maxVisible = 5;
            let startPage = Math.max(1, currentPage - 2);
            let endPage = Math.min(totalPages, startPage + maxVisible - 1);
            
            if (endPage - startPage + 1 < maxVisible) {
                startPage = Math.max(1, endPage - maxVisible + 1);
            }

            if (startPage > 1) {
                html += `<button onclick="goToPage(1)" class="w-6 h-6 rounded font-bold text-[10px] bg-[#0f172a] text-slate-400 border border-slate-800 hover:bg-slate-800 hover:text-white transition-all">1</button>`;
                if (startPage > 2) {
                    html += `<span class="text-slate-600 text-xs px-0.5 select-none">...</span>`;
                }
            }

            for (let i = startPage; i <= endPage; i++) {
                const active = i === currentPage ? 'bg-amber-500 text-black border-amber-500 font-black' : 'bg-[#0f172a] text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-white transition-all';
                html += `<button onclick="goToPage(${i})" class="w-6 h-6 rounded font-bold text-[10px] ${active} border">${i}</button>`;
            }

            if (endPage < totalPages) {
                if (endPage < totalPages - 1) {
                    html += `<span class="text-slate-600 text-xs px-0.5 select-none">...</span>`;
                }
                html += `<button onclick="goToPage(${totalPages})" class="w-6 h-6 rounded font-bold text-[10px] bg-[#0f172a] text-slate-400 border border-slate-800 hover:bg-slate-800 hover:text-white transition-all">${totalPages}</button>`;
            }
            pageNumEl.innerHTML = html;
        }

        if (jumpEl) {
            jumpEl.innerHTML = Array.from({ length: totalPages }, (_, i) => `<option value="${i + 1}" ${i + 1 === currentPage ? 'selected' : ''}>หน้า ${i + 1}</option>`).join('');
        }
    }

    window.goToPage = function(p) {
        currentPage = parseInt(p);
        const container = document.getElementById('staffTableContainer');
        if (container) container.scrollTop = 0;
        renderTable();
    }
    window.nextPage = function() {
        if (currentPage < Math.ceil(filteredData.length / itemsPerPage)) {
            currentPage++;
            const container = document.getElementById('staffTableContainer');
            if (container) container.scrollTop = 0;
            renderTable();
        }
    }
    window.prevPage = function() {
        if (currentPage > 1) {
            currentPage--;
            const container = document.getElementById('staffTableContainer');
            if (container) container.scrollTop = 0;
            renderTable();
        }
    }

    // --- Add/Edit Staff Operations (CRUD) ---
    window.addNewStaff = async function() {
        const id = document.getElementById('empId').value;
        const name = document.getElementById('empName').value;
        const unit = document.getElementById('empUnit').value;
        const role = document.getElementById('empRole').value;
        const level = document.getElementById('empLevel').value;
        const zone = document.getElementById('empZone').value;
        const status = document.getElementById('empStatus').value;
        const password = document.getElementById('empPassword').value;
        const vehicle_rate = document.getElementById('empVehicleRate').value;

        if (!id || !name) return alert("กรุณากรอกข้อมูลหลักให้ครบถ้วน");

        // Owner Singleton Protection
        if (level === 'Owner') {
            const existingOwner = staffData.find(s => s.level === 'Owner');
            if (existingOwner && (!editingEmpId || editingEmpId !== existingOwner.emp_id)) {
                return alert('⚠️ ระบบนี้อนุญาตให้มี "เจ้าของระบบ" (Owner) ได้เพียงคนเดียวเท่านั้นครับบอส!');
            }
        }

        const payload = { emp_id: id, name, unit, role, level, zone, status, vehicle_rate: level === 'Guard' ? 0 : parseFloat(vehicle_rate) };
        if (password) {
            payload.password = password;
        } else if (!editingEmpId) {
            payload.password = id.substring(0, 4);
        }

        try {
            const { error } = editingEmpId ?
                await supabaseClient.from('staff').update(payload).eq('emp_id', editingEmpId) :
                await supabaseClient.from('staff').insert([payload]);

            if (error) throw error;

            alert(editingEmpId ? 'แก้ไขข้อมูลพนักงานสำเร็จ' : 'เพิ่มพนักงานใหม่สำเร็จ');
            clearForm();
            await fetchStaff();
        } catch (e) {
            console.error("Staff Save Error:", e);
            alert("ไม่สามารถบันทึกข้อมูลได้: " + (e.message || "เกิดข้อผิดพลาดในการเชื่อมต่อ"));
        }
    }

    window.editStaff = function(id) {
        const s = staffData.find(x => x.id === id);
        editingEmpId = s.id;
        document.getElementById('empId').value = s.id;
        document.getElementById('empName').value = s.name;
        document.getElementById('empUnit').value = s.unit;
        document.getElementById('empRole').value = s.role;
        document.getElementById('empLevel').value = s.level;
        document.getElementById('empZone').value = s.zone || '';
        document.getElementById('empStatus').value = s.status;
        document.getElementById('empVehicleRate').value = s.vehicle_rate || '5';
        document.getElementById('btnText').innerText = 'บันทึกการแก้ไข';
        
        toggleVehicleRateVisibility();
        
        // เลื่อนฟอร์มขึ้นมาบนสุดเพื่อให้ทำงานง่ายขึ้น
        window.scrollTo({ top: 0, behavior: 'smooth' });
        document.getElementById('empId').focus();
    }

    window.deleteStaff = async function(id) {
        const targetStaff = staffData.find(s => s.id === id);
        const currentUser = JSON.parse(localStorage.getItem('nextgen_user'));

        // ป้องกันลบตัวเองเพื่อความปลอดภัย
        if (id === currentUser.emp_id) {
            return alert('⚠️ บอสครับ! ลบตัวเองไม่ได้นะ เดี๋ยวเข้าหน้าเว็บไม่ได้ครับ!');
        }

        // ป้องกันสิทธิ์ลบ Owner
        if (targetStaff && targetStaff.level === 'Owner' && currentUser.level !== 'Owner') {
            return alert('⚠️ สิทธิของบอสไม่เพียงพอที่จะลบ "เจ้าของระบบ" ได้ครับ!');
        }

        if (!confirm('ยืนยันการลบพนักงาน ' + id + ' ใช่หรือไม่? บอสตัดสินใจดีแล้วนะครับ')) return;
        try {
            const { error } = await supabaseClient.from('staff').delete().eq('emp_id', id);
            if (error) throw error;
            alert('กำจัดพนักงานรหัส ' + id + ' ออกจากระบบเรียบร้อยครับ!');
            await fetchStaff();
        } catch (e) {
            console.error("Staff Delete Error:", e);
            alert("ไม่สามารถลบข้อมูลได้: " + (e.message || "เกิดข้อผิดพลาดในการเชื่อมต่อ"));
        }
    }

    window.clearForm = function() {
        editingEmpId = null;
        document.getElementById('btnText').innerText = 'บันทึกข้อมูล';
        ['empId', 'empName', 'empUnit', 'empRole', 'empPassword'].forEach(i => document.getElementById(i).value = '');
        document.getElementById('empVehicleRate').value = '5';
        document.getElementById('empStatus').value = 'เปิด';
        document.getElementById('empLevel').value = 'Guard';
        document.getElementById('empZone').value = '';
        
        toggleVehicleRateVisibility();
    }

    window.autoFillPassword = function(val) {
        if (!editingEmpId) {
            const passInput = document.getElementById('empPassword');
            if (passInput) passInput.value = val.substring(0, 4);
        }
    }

    window.toggleRowPassword = function(id, pass) {
        const el = document.getElementById(`pass-${id}`);
        const overlay = document.getElementById(`overlay-${id}`);

        if (el.classList.contains('blur-[3px]')) {
            el.classList.remove('blur-[3px]', 'text-amber-500/30');
            el.classList.add('text-amber-500');
            overlay.style.display = 'none';
        } else {
            el.classList.add('blur-[3px]', 'text-amber-500/30');
            el.classList.remove('text-amber-500');
            overlay.style.display = 'flex';
        }
    }

    // Toggle Form Password Visibility
    window.toggleEmpPassword = function() {
        const input = document.getElementById('empPassword');
        const icon = document.getElementById('eyeIcon');
        if (!input || !icon) return;
        
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
        }
    }

    // --- Autocomplete Suggestions for Unit Input ---
    window.handleUnitInput = function(val) {
        const box = document.getElementById('unitSuggestions');
        if (!box) return;
        const matches = val ? unitsData.filter(u => u.unit_name.toLowerCase().includes(val.toLowerCase()) || u.unit_code.toLowerCase().includes(val.toLowerCase())) : unitsData;
        if (matches.length > 0) {
            box.innerHTML = matches.slice(0, 8).map(u => `<div class="suggestion-item" onclick="selectUnit('${u.unit_name}')"><div class="font-bold text-white text-[11px]">${u.unit_name}</div><div class="text-[9px] text-amber-500/80">${u.unit_code}</div><div class="text-[8px] text-slate-400">${u.zone}</div></div>`).join('');
            box.classList.remove('hidden');
        } else if (val) {
            box.innerHTML = '<div class="p-4 text-center text-slate-500 text-[10px]">ไม่พบข้อมูล</div>';
            box.classList.remove('hidden');
        } else {
            box.classList.add('hidden');
        }
    }

    window.selectUnit = function(name) {
        document.getElementById('empUnit').value = name;
        document.getElementById('unitSuggestions').classList.add('hidden');
        
        // Auto-fill Zone based on selected Unit
        const found = unitsData.find(u => u.unit_name === name);
        if (found && found.zone) {
            const zoneSelect = document.getElementById('empZone');
            if (zoneSelect) zoneSelect.value = found.zone;
        }
    }

    document.addEventListener('click', e => {
        if (!e.target.closest('#empUnit') && !e.target.closest('#unitSuggestions')) {
            document.getElementById('unitSuggestions')?.classList.add('hidden');
        }
    });

    // --- Bulk Action Helpers ---
    window.toggleAll = function() {
        const masterCheckbox = document.getElementById('selectAllStaff');
        const isChecked = masterCheckbox.checked;

        if (isChecked) {
            filteredData.forEach(item => selectedItems.add(item.id));
        } else {
            selectedItems.clear();
        }
        renderTable();
    }

    window.toggleSingleSelection = function(id) {
        if (selectedItems.has(id)) selectedItems.delete(id);
        else selectedItems.add(id);
        renderTable();
    }

    window.updateBulkUI = function() {
        const bar = document.getElementById('bulkActionBar');
        const countDisplay = document.getElementById('selectedCountDisplay');
        const typeDisplay = document.getElementById('selectedTypeDisplay');
        if (!bar) return;

        if (selectedItems.size > 0) {
            countDisplay.innerText = selectedItems.size;
            typeDisplay.innerText = 'พนักงาน';
            bar.classList.remove('hidden');
            setTimeout(() => bar.classList.remove('translate-y-20'), 10);
        } else {
            bar.classList.add('translate-y-20');
            setTimeout(() => {
                if (selectedItems.size === 0) bar.classList.add('hidden');
            }, 500);
        }
    }

    window.clearSelection = function() {
        selectedItems.clear();
        const sStaff = document.getElementById('selectAllStaff');
        if (sStaff) sStaff.checked = false;
        updateBulkUI();
        renderTable();
    }

    window.handleBulkDelete = async function() {
        if (!confirm(`ยืนยันการลบพนักงานทั้งหมด ${selectedItems.size} รายการที่เลือกใช่หรือไม่?`)) return;

        const ids = Array.from(selectedItems);
        try {
            const { error } = await supabaseClient.from('staff').delete().in('emp_id', ids);
            if (error) throw error;

            alert(`ลบพนักงานจำนวน ${ids.length} รายการสำเร็จ`);
            selectedItems.clear();
            await fetchStaff();
        } catch (err) {
            console.error("Bulk Delete Error:", err);
            alert("เกิดข้อผิดพลาดในการลบแบบกลุ่ม: " + err.message);
        }
    }

    window.handleBulkStatus = async function(newStatus) {
        if (!confirm(`ยืนยันการเปลี่ยนสถานะเป็น "${newStatus}" สำหรับพนักงาน ${selectedItems.size} คนที่เลือก?`)) return;

        const ids = Array.from(selectedItems);
        try {
            const { error } = await supabaseClient.from('staff').update({ status: newStatus }).in('emp_id', ids);
            if (error) throw error;

            alert(`อัปเดตสถานะพนักงานจำนวน ${ids.length} รายการสำเร็จ`);
            selectedItems.clear();
            await fetchStaff();
        } catch (err) {
            console.error("Bulk Status Error:", err);
            alert("เกิดข้อผิดพลาดในการอัปเดตสถานะ: " + err.message);
        }
    }

    window.handleBulkZone = async function() {
        const newZone = prompt(`กรุณากรอกชื่อเขตใหม่สำหรับพนักงาน ${selectedItems.size} คนที่เลือก:`);
        if (newZone === null || newZone.trim() === '') return;

        const ids = Array.from(selectedItems);
        try {
            const { error } = await supabaseClient.from('staff').update({ zone: newZone }).in('emp_id', ids);
            if (error) throw error;

            alert(`ย้ายเขตพนักงานจำนวน ${ids.length} รายการไปยัง "${newZone}" สำเร็จ`);
            selectedItems.clear();
            await fetchStaff();
        } catch (err) {
            console.error("Bulk Zone Error:", err);
            alert("เกิดข้อผิดพลาดในการย้ายเขต: " + err.message);
        }
    }

    window.openBulkEditModal = function() {
        const modal = document.getElementById('bulkEditModal');
        if (!modal) return;

        document.getElementById('bulkEditCountDisplay').innerText = selectedItems.size;

        // Reset fields
        document.getElementById('bulkEditStatusCheck').checked = false;
        document.getElementById('bulkEditZoneCheck').checked = false;
        document.getElementById('bulkEditZone').value = '';

        modal.classList.remove('hidden');
    }

    window.closeBulkEditModal = function() {
        const modal = document.getElementById('bulkEditModal');
        if (modal) modal.classList.add('hidden');
    }

    window.applyBulkEdit = async function() {
        const doStatus = document.getElementById('bulkEditStatusCheck').checked;
        const doZone = document.getElementById('bulkEditZoneCheck').checked;

        if (!doStatus && !doZone) {
            return alert("กรุณาเลือกอย่างน้อยหนึ่งหัวข้อที่ต้องการแก้ไขแบบกลุ่มครับ");
        }

        const payload = {};
        if (doStatus) payload.status = document.getElementById('bulkEditStatus').value;
        if (doZone) payload.zone = document.getElementById('bulkEditZone').value;

        if (doZone && !payload.zone.trim()) {
            return alert("กรุณากรอกชื่อเขตใหม่ครับ");
        }

        if (!confirm(`ยืนยันการแก้ไขข้อมูลพนักงานแบบกลุ่ม ${selectedItems.size} รายการที่เลือกใช่หรือไม่?`)) return;

        const ids = Array.from(selectedItems);
        try {
            const { error } = await supabaseClient.from('staff').update(payload).in('emp_id', ids);
            if (error) throw error;

            alert(`อัปเดตข้อมูลพนักงานแบบกลุ่มจำนวน ${ids.length} รายการเรียบร้อยแล้วครับ!`);
            closeBulkEditModal();
            selectedItems.clear();
            await fetchStaff();
        } catch (err) {
            console.error("Bulk Edit Save Error:", err);
            alert("เกิดข้อผิดพลาดในการบันทึกข้อมูลแบบกลุ่ม: " + err.message);
        }
    }

    // --- Real-time Fuel Rates Loader ---
    let fuelRates = { gasoline: 5.0, diesel: 4.5, motorcycle: 3.0 };

    async function loadFuelRates() {
        // 1. Local Cache Fallback
        const local = localStorage.getItem('NEXTGEN_fuel_rates');
        if (local) {
            try {
                fuelRates = JSON.parse(local);
            } catch(e){}
        }

        // 2. Real-time Supabase Pull
        if (window.supabaseClient) {
            try {
                const { data, error } = await supabaseClient
                    .from('fuel_settings')
                    .select('key, value');
                
                if (!error && data && data.length > 0) {
                    const rates = {};
                    data.forEach(item => {
                        rates[item.key] = parseFloat(item.value);
                    });
                    if (rates.gasoline || rates.diesel || rates.motorcycle) {
                        fuelRates = {
                            gasoline: rates.gasoline || fuelRates.gasoline,
                            diesel: rates.diesel || fuelRates.diesel,
                            motorcycle: rates.motorcycle || fuelRates.motorcycle
                        };
                        localStorage.setItem('NEXTGEN_fuel_rates', JSON.stringify(fuelRates));
                    }
                }
            } catch (err) {
                console.warn("Supabase fuel load in ManageStaff error:", err);
            }
        }

        updateDropdownsWithFuelRates();
    }

    function updateDropdownsWithFuelRates() {
        const empSelect = document.getElementById('empVehicleRate');
        if (empSelect) {
            empSelect.innerHTML = `
                <option value="5">🚗 เบนซิน (${fuelRates.gasoline})</option>
                <option value="4.5">🚛 ดีเซล (${fuelRates.diesel})</option>
                <option value="3">🏍️ มอเตอร์ไซค์ (${fuelRates.motorcycle})</option>
            `;
        }

        const filterSelect = document.getElementById('hFilterVehicle');
        if (filterSelect) {
            filterSelect.innerHTML = `
                <option value="">ทั้งหมด</option>
                <option value="5">${fuelRates.gasoline} (เบนซิน)</option>
                <option value="4.5">${fuelRates.diesel} (ดีเซล)</option>
                <option value="3">${fuelRates.motorcycle} (มอเตอร์ไซค์)</option>
            `;
        }
    }

})();
