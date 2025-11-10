# Quick Reference Card - Keep This Open!

## 🔑 Essential Commands

### Connect to VPS
```bash
ssh root@YOUR_VPS_IP
```

### Navigate to Project
```bash
cd /var/www/student-admin-portal
```

### Check App Status
```bash
pm2 status
```

### View Logs
```bash
pm2 logs student-admin-portal
```

### Restart App
```bash
pm2 restart student-admin-portal
```

### Check Nginx
```bash
systemctl status nginx
systemctl restart nginx
```

---

## 📍 Where Things Are

- **Project location:** `/var/www/student-admin-portal`
- **Environment file:** `/var/www/student-admin-portal/.env`
- **Nginx config:** `/etc/nginx/sites-available/student-admin-portal`
- **App runs on:** Port 3000 (internal)
- **Website accessible on:** Port 80 (HTTP) or 443 (HTTPS)

---

## 🚨 Emergency Fixes

### App Won't Start
```bash
cd /var/www/student-admin-portal
pm2 logs student-admin-portal
pm2 restart student-admin-portal
```

### Website Shows Error
```bash
pm2 restart student-admin-portal
systemctl restart nginx
```

### Can't Access Website
```bash
ufw status
pm2 status
systemctl status nginx
```

---

## 📞 Need Help?

1. Check the logs: `pm2 logs student-admin-portal`
2. Check if app is running: `pm2 status`
3. Check Nginx: `systemctl status nginx`
4. Restart everything: `pm2 restart student-admin-portal && systemctl restart nginx`

