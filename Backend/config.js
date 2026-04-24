// 🛡️ Nexgen System Centor - Configuration File
// ไฟล์นี้คือ "หัวใจ" ที่เก็บกุญแจเชื่อมต่อทั้งหมด

const SUPABASE_URL = 'https://mvcsbylbsffgbkocehzx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12Y3NieWxic2ZmZ2Jrb2NlaHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzMjI2NzgsImV4cCI6MjA5MTg5ODY3OH0.pxuSq1TuaSetJZAabrSPqXy6RAXAwaI_VWZ9zf5TypI';

// สั่งให้เครื่องยนต์ Supabase เริ่มทำงาน
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// บันทึก: ต่อไปนี้เวลาบอสจะใช้งานในหน้าอื่น 
// แค่ดึงไฟล์นี้ไปแปะ ระบบจะรู้จัก supabaseClient ทันทีค่ะ