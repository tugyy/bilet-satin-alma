FROM php:8.1-apache

# Copy backend sources
WORKDIR /var/www/html
COPY . /var/www/html/

# Ensure correct permissions for Apache
RUN chown -R www-data:www-data /var/www/html \
    && a2enmod rewrite

EXPOSE 80

CMD ["/usr/sbin/apache2ctl", "-D", "FOREGROUND"]
