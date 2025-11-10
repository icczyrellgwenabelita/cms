#!/bin/bash

echo "🚀 Starting VPS Setup for CareSim Student Admin Portal"
echo "=================================================="
echo ""

echo "Step 1: Updating system..."
apt update && apt upgrade -y

echo ""
echo "Step 2: Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

echo ""
echo "Step 3: Verifying Node.js installation..."
node --version
npm --version

echo ""
echo "Step 4: Installing PM2..."
npm install -g pm2

echo ""
echo "Step 5: Installing Nginx..."
apt install -y nginx
systemctl start nginx
systemctl enable nginx

echo ""
echo "Step 6: Installing Git..."
apt install -y git

echo ""
echo "✅ Basic setup complete!"
echo ""
echo "Next steps:"
echo "1. Navigate to /var/www: cd /var/www"
echo "2. Clone your repository or upload files"
echo "3. Create .env file with your credentials"
echo "4. Run: npm install --production"
echo "5. Configure Nginx"
echo "6. Start with PM2: pm2 start server.js --name student-admin-portal"
echo ""
echo "See HOSTINGER_VPS_DEPLOYMENT.md for detailed instructions!"

