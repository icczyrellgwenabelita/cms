# Hostinger VPS Deployment Guide - Step by Step

Don't worry! I'll guide you through each step. Take your time and follow along. 🚀

## 📋 Prerequisites Checklist

Before we start, make sure you have:
- [ ] Hostinger VPS account (already purchased)
- [ ] VPS IP address and root password (from Hostinger email)
- [ ] Domain name (optional, but recommended)
- [ ] Your Firebase credentials ready
- [ ] SSH client (we'll use built-in Windows tools)

---

## Step 1: Connect to Your VPS (5 minutes)

### On Windows:

1. **Open PowerShell** (Press `Windows Key + X`, then select "Windows PowerShell" or "Terminal")

2. **Connect via SSH:**
   ```powershell
   ssh root@YOUR_VPS_IP
   ```
   Replace `YOUR_VPS_IP` with your actual VPS IP address (e.g., `ssh root@123.45.67.89`)

3. **When prompted, type "yes"** to accept the fingerprint

4. **Enter your root password** (you won't see it as you type - this is normal!)

5. **You should see something like:**
   ```
   root@vps123456:~#
   ```
   ✅ **Success!** You're now connected to your server.

---

## Step 2: Update Your Server (2 minutes)

Once connected, run these commands one by one:

```bash
apt update
```

Wait for it to finish, then:

```bash
apt upgrade -y
```

This updates your server. It might take a few minutes. Don't worry if you see lots of text scrolling - that's normal!

---

## Step 3: Install Node.js (3 minutes)

We'll install Node.js version 18 (required for your app):

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
```

Wait for it to finish, then:

```bash
apt install -y nodejs
```

**Verify it worked:**
```bash
node --version
```

You should see: `v18.x.x` (any version starting with 18 is good!)

```bash
npm --version
```

You should see a version number like `9.x.x`

✅ **If both show versions, you're good to go!**

---

## Step 4: Install PM2 (Process Manager) (1 minute)

PM2 will keep your app running even if you disconnect:

```bash
npm install -g pm2
```

**Verify:**
```bash
pm2 --version
```

Should show a version number.

---

## Step 5: Install Nginx (Web Server) (2 minutes)

Nginx will handle web traffic:

```bash
apt install -y nginx
```

Start Nginx:
```bash
systemctl start nginx
```

Enable it to start on boot:
```bash
systemctl enable nginx
```

**Test it:**
Open your browser and go to: `http://YOUR_VPS_IP`

You should see "Welcome to nginx!" page. ✅

---

## Step 6: Upload Your Application Files (10 minutes)

### Option A: Using Git (Recommended - Easiest)

**On your local computer (Windows):**

1. **Make sure your code is on GitHub:**
   - If not already, create a GitHub repository
   - Push your code to GitHub

2. **Back on your VPS (SSH connection), install Git:**
   ```bash
   apt install -y git
   ```

3. **Navigate to web directory:**
   ```bash
   cd /var/www
   ```

4. **Clone your repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git student-admin-portal
   ```
   (Replace with your actual GitHub URL)

5. **Navigate into the project:**
   ```bash
   cd student-admin-portal
   ```

### Option B: Using SFTP (If you don't use Git)

1. **Download WinSCP** (free SFTP client): https://winscp.net/

2. **Connect to your VPS:**
   - Host: Your VPS IP
   - Username: `root`
   - Password: Your root password
   - Protocol: SFTP

3. **Upload your project folder** to `/var/www/student-admin-portal`

4. **Back in SSH, navigate to it:**
   ```bash
   cd /var/www/student-admin-portal
   ```

---

## Step 7: Install Dependencies (3 minutes)

Still in your project directory (`/var/www/student-admin-portal`):

```bash
npm install --production
```

This installs all your Node.js packages. Wait for it to finish (might take 2-3 minutes).

---

## Step 8: Create Environment Variables File (5 minutes)

Create the `.env` file:

```bash
nano .env
```

**This opens a text editor. Paste your environment variables:**

```env
PORT=3000
FIREBASE_PROJECT_ID=your-project-id-here
FIREBASE_CLIENT_EMAIL=your-email@project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour\nPrivate\nKey\nHere\n-----END PRIVATE KEY-----\n"
FIREBASE_DATABASE_URL=https://your-project-id-default-rtdb.firebaseio.com
JWT_SECRET=your-very-secure-random-string-here
```

**Important Notes:**
- Replace ALL placeholder values with your actual Firebase credentials
- For `FIREBASE_PRIVATE_KEY`: Keep the `\n` as literal newlines (press Enter for each line)
- For `JWT_SECRET`: Use a long random string (you can generate one at: https://randomkeygen.com/)

**To save and exit:**
1. Press `Ctrl + X`
2. Press `Y` (to confirm)
3. Press `Enter` (to save)

---

## Step 9: Configure Nginx (5 minutes)

Create Nginx configuration:

```bash
nano /etc/nginx/sites-available/student-admin-portal
```

**Paste this configuration:**

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN.com www.YOUR_DOMAIN.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**Replace `YOUR_DOMAIN.com` with your actual domain, or use your VPS IP if you don't have a domain yet.**

**Save and exit:** `Ctrl + X`, then `Y`, then `Enter`

**Enable the site:**
```bash
ln -s /etc/nginx/sites-available/student-admin-portal /etc/nginx/sites-enabled/
```

**Test the configuration:**
```bash
nginx -t
```

Should say: `syntax is ok` and `test is successful` ✅

**Reload Nginx:**
```bash
systemctl reload nginx
```

---

## Step 10: Start Your Application with PM2 (2 minutes)

Navigate to your project:
```bash
cd /var/www/student-admin-portal
```

Start the app:
```bash
pm2 start server.js --name "student-admin-portal"
```

**Check if it's running:**
```bash
pm2 status
```

You should see your app listed with status "online" ✅

**Save PM2 configuration (so it starts on reboot):**
```bash
pm2 save
pm2 startup
```

Copy and run the command it gives you (it will look like: `sudo env PATH=...`)

---

## Step 11: Test Your Application (2 minutes)

1. **Check if your app is running:**
   ```bash
   pm2 logs student-admin-portal
   ```
   Press `Ctrl + C` to exit the logs

2. **Visit your website:**
   - If you have a domain: `http://yourdomain.com`
   - If using IP: `http://YOUR_VPS_IP`

3. **You should see your login page!** ✅

---

## Step 12: Set Up SSL Certificate (HTTPS) - Optional but Recommended (10 minutes)

This makes your site secure with HTTPS:

```bash
apt install -y certbot python3-certbot-nginx
```

**Get SSL certificate:**
```bash
certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

**Follow the prompts:**
- Enter your email
- Agree to terms
- Choose whether to redirect HTTP to HTTPS (recommend option 2: Yes)

**Done!** Your site now has HTTPS! 🔒

---

## Step 13: Configure Firewall (Security) (2 minutes)

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Type `y` when prompted.

---

## ✅ Deployment Complete!

Your website should now be live! 🎉

---

## 🔧 Useful Commands (Save These!)

**Check if app is running:**
```bash
pm2 status
```

**View app logs:**
```bash
pm2 logs student-admin-portal
```

**Restart your app:**
```bash
pm2 restart student-admin-portal
```

**Stop your app:**
```bash
pm2 stop student-admin-portal
```

**Check Nginx status:**
```bash
systemctl status nginx
```

---

## 🆘 Troubleshooting

### Problem: Can't connect via SSH
- **Solution:** Make sure you're using the correct IP and password from Hostinger

### Problem: "Permission denied"
- **Solution:** Make sure you're using `root` user or add `sudo` before commands

### Problem: App not starting
- **Check logs:** `pm2 logs student-admin-portal`
- **Check .env file:** Make sure all variables are set correctly
- **Check port:** Make sure port 3000 isn't blocked

### Problem: Website shows "502 Bad Gateway"
- **Check if app is running:** `pm2 status`
- **Restart app:** `pm2 restart student-admin-portal`
- **Check Nginx:** `systemctl restart nginx`

### Problem: Can't access website
- **Check firewall:** Make sure ports 80 and 443 are open
- **Check Nginx:** `systemctl status nginx`
- **Check app:** `pm2 status`

---

## 📝 Updating Your Application

When you make changes to your code:

1. **If using Git:**
   ```bash
   cd /var/www/student-admin-portal
   git pull
   npm install --production
   pm2 restart student-admin-portal
   ```

2. **If using SFTP:**
   - Upload new files via WinSCP
   - Then run:
     ```bash
     cd /var/www/student-admin-portal
     npm install --production
     pm2 restart student-admin-portal
     ```

---

## 💡 Tips

- **Keep your SSH connection open** while testing
- **Don't close the terminal** until everything works
- **Take screenshots** of any error messages
- **Test each step** before moving to the next
- **It's okay to make mistakes** - we can fix them!

---

## 🎯 Quick Checklist

- [ ] Connected to VPS via SSH
- [ ] Updated server
- [ ] Installed Node.js 18
- [ ] Installed PM2
- [ ] Installed Nginx
- [ ] Uploaded application files
- [ ] Installed dependencies
- [ ] Created .env file with credentials
- [ ] Configured Nginx
- [ ] Started app with PM2
- [ ] Tested website in browser
- [ ] Set up SSL (optional)
- [ ] Configured firewall

---

**You've got this!** Take it one step at a time. If you get stuck at any point, let me know and I'll help you! 😊

