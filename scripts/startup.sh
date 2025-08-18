# 1. Make a directory on the local disk to run the code from
mkdir -p /usr/local/cachedapp/

# 2. Copy the contents from shared storage to a folder on local disk
cp -R /home/site/wwwroot /usr/local/cachedapp/wwwroot

# 3. Change the symlink to point to the local folder
unlink /var/www/html/wwwroot
ln -s /usr/local/cachedapp/wwwroot /var/www/html/wwwroot

# 4. Copy the apache2.conf file from our code to the local disk
cp /home/site/wwwroot/apache2.conf /etc/apache2/