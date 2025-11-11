const { db } = require('../config/firebase');
const bcrypt = require('bcryptjs');

async function createAdmin() {
  try {
    const email = 'asianschoolregistrar@gmail.com';
    const password = 'asatcaresim111';
    
    console.log('Creating admin account...');
    console.log('Email:', email);
    
    // Check if admin already exists
    const adminsRef = db.ref('admins');
    const snapshot = await adminsRef.once('value');
    const admins = snapshot.val() || {};
    
    for (const [id, admin] of Object.entries(admins)) {
      if (admin.email === email) {
        console.log('Admin already exists with this email. Updating password...');
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.ref(`admins/${id}`).update({
          password: hashedPassword,
          updatedAt: new Date().toISOString()
        });
        console.log('✅ Admin password updated successfully!');
        console.log('Admin ID:', id);
        process.exit(0);
      }
    }
    
    // Create new admin
    const hashedPassword = await bcrypt.hash(password, 10);
    const newAdminRef = adminsRef.push();
    const adminId = newAdminRef.key;
    
    await newAdminRef.set({
      email,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    });
    
    console.log('✅ Admin account created successfully!');
    console.log('Admin ID:', adminId);
    console.log('Email:', email);
    console.log('\nYou can now login with:');
    console.log('Email: asianschoolregistrar@gmail.com');
    console.log('Password: asatcaresim111');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin:', error);
    process.exit(1);
  }
}

createAdmin();

