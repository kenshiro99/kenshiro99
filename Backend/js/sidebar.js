/**
 * 🛡️ Nexgen System Center - Universal Sidebar Component
 * จัดการเมนูหลักที่เดียว อัปเดตทุกหน้าอัตโนมัติ
 */

function renderSidebar() {
    const sidebarContainer = document.getElementById('sidebar-container');
    if (!sidebarContainer) return;

    // ตรวจสอบว่าหน้าปัจจุบันคือหน้าอะไร เพื่อไฮไลท์เมนู
    const currentPage = window.location.pathname.split('/').pop();

    const menuHTML = `
        <div class="pt-6 pb-2 text-center">
            <img src="../img/logo-1.jpg" onerror="this.src='https://ui-avatars.com/api/?name=N&background=f59e0b&color=fff'"
                class="w-16 h-16 mx-auto rounded-full border-2 border-amber-500 mb-3 shadow-lg object-cover">
            <h2 class="text-2xl font-black text-white uppercase tracking-tighter">NEXGEN</h2>
            <p class="text-[10px] text-amber-500 font-bold tracking-[3px]">SYSTEM CENTER</p>
        </div>

        <nav class="flex-1 overflow-y-auto mt-4 pb-6 custom-scrollbar">
            <div class="menu-header">Overview</div>
            <div class="menu-item ${currentPage === 'dashboard.html' || currentPage === '' ? 'active' : ''}" onclick="handleMenuClick('dashboard', 'dashboard.html')">
                <i class="fas fa-home"></i> แดชบอร์ด
            </div>

            <div class="menu-header">Reporting</div>
            <div class="menu-item" onclick="handleMenuClick('edit-report', 'dashboard.html')">
                <i class="fas fa-edit"></i> แก้ไขรายงาน
            </div>
            <div class="menu-item" onclick="handleMenuClick('travel-report', 'dashboard.html')">
                <i class="fas fa-car"></i> รายงานการเดินทาง
            </div>
            <div class="menu-item" onclick="handleMenuClick('check-in', 'dashboard.html')">
                <i class="fas fa-users"></i> รายงานการเข้า/ออก
            </div>

            <div class="menu-item has-submenu ${(currentPage === 'OP05Report.html' || currentPage === 'GuardReport.html' || currentPage === 'FMQC02Report.html') ? 'active' : ''}" onclick="toggleSubMenu('workSubmenu', this)">
                <i class="fas fa-clipboard-check"></i> รายงานการทำงาน
                <i class="fas fa-chevron-down arrow ${(currentPage === 'OP05Report.html' || currentPage === 'GuardReport.html' || currentPage === 'FMQC02Report.html') ? 'rotate-180' : ''}"></i>
            </div>
            <div id="workSubmenu" class="submenu ${(currentPage === 'OP05Report.html' || currentPage === 'GuardReport.html' || currentPage === 'FMQC02Report.html') ? 'open' : ''}">
                <div class="submenu-item ${currentPage === 'FMQC02Report.html' ? 'active' : ''}" onclick="window.location.href='FMQC02Report.html'">
                    <i class="fas fa-search-location"></i> รายงานเข้าตรวจหน่วยงาน
                </div>
                <div class="submenu-item ${currentPage === 'OP05Report.html' ? 'active' : ''}" onclick="window.location.href='OP05Report.html'">
                    <i class="fas fa-handshake"></i> รายงานพบผู้ว่าจ้าง (OP05)
                </div>
                <div class="submenu-item" onclick="handleMenuClick('report-rollcall', 'dashboard.html')">
                    <i class="fas fa-align-left"></i> รายงานการรวมแถว
                </div>
                <div class="submenu-item" onclick="handleMenuClick('report-training', 'dashboard.html')">
                    <i class="fas fa-chalkboard-teacher"></i> รายงานอบรมประจำเดือน
                </div>
                <div class="submenu-item ${currentPage === 'GuardReport.html' ? 'active' : ''}" onclick="window.location.href='GuardReport.html'">
                    <i class="fas fa-user-shield"></i> รายงานเข้า/ออก รปภ.
                </div>
            </div>

            <div class="menu-header">Administration</div>
            <div class="menu-item" onclick="handleMenuClick('staff', 'dashboard.html')">
                <i class="fas fa-user-cog"></i> จัดการพนักงาน
            </div>
            <div class="menu-item" onclick="handleMenuClick('units', 'dashboard.html')">
                <i class="fas fa-building"></i> จัดการหน่วยงาน
            </div>
            <div class="menu-item" onclick="handleMenuClick('leaves', 'dashboard.html')">
                <i class="fas fa-calendar-check"></i> อนุมัติการลา
            </div>
            <div class="menu-item" onclick="handleMenuClick('finance', 'dashboard.html')">
                <i class="fas fa-credit-card"></i> การเงิน
            </div>
        </nav>

        <div class="px-8 pb-8">
            <button onclick="logout()" class="w-full py-2 border border-slate-800 rounded-lg text-xs text-slate-500 hover:text-red-400 font-bold tracking-widest mb-6 transition-colors uppercase">LOGOUT</button>
            <div class="text-center pt-4 border-t border-white/5 space-y-2">
                <p class="text-[8px] text-slate-400 font-bold tracking-[2px] opacity-80">&copy; 2026 &bull; NEXGEN SYSTEM CENTER Ver.1.0</p>
                <p class="text-[8px] text-slate-500 font-medium tracking-tight">Developer: Ponchai Onkum</p>
            </div>
        </div>
    `;

    sidebarContainer.innerHTML = menuHTML;
}

// ฟังก์ชันจัดการการคลิกเมนู (อัจฉริยะ)
function handleMenuClick(tabId, targetPage) {
    const currentPage = window.location.pathname.split('/').pop();
    
    if (currentPage === 'dashboard.html' || currentPage === '') {
        if (typeof switchTab === 'function') {
            // ค้นหา Element ของเมนูที่คลิก เพื่อส่งให้ switchTab
            const menuItem = document.querySelector(`[onclick*="'${tabId}'"]`);
            switchTab(tabId, menuItem);
            // อัปเดต Hash เพื่อให้ URL เปลี่ยนตาม (แต่ไม่โหลดหน้าใหม่)
            history.pushState(null, null, `#${tabId}`);
        } else {
            window.location.href = `${targetPage}#${tabId}`;
        }
    } else {
        window.location.href = `${targetPage}#${tabId}`;
    }
}

// ฟังก์ชันเปิด/ปิดเมนูย่อย
function toggleSubMenu(id, el) {
    const submenu = document.getElementById(id);
    const arrow = el.querySelector('.arrow');
    if (submenu) {
        submenu.classList.toggle('open');
        if (arrow) arrow.classList.toggle('rotate-180');
    }
}

// ฟังก์ชัน Logout
function logout() {
    localStorage.removeItem('nexgen_user');
    window.location.href = 'login.html';
}

// เริ่มทำงานเมื่อโหลดหน้า
document.addEventListener('DOMContentLoaded', renderSidebar);
