// welcome.js
document.addEventListener('DOMContentLoaded', function() {
    // Smooth animations for feature cards
    const features = document.querySelectorAll('.feature-card');
    features.forEach((feature, index) => {
        feature.style.opacity = '0';
        feature.style.transform = 'translateY(20px)';
        
        setTimeout(() => {
            feature.style.transition = 'all 0.9s ease';
            feature.style.opacity = '1';
            feature.style.transform = 'translateY(0)';
        }, index * 150);
    });

    // Add external link handler for site badges
    const siteBadges = document.querySelectorAll('.site-badge');
    siteBadges.forEach(badge => {
        badge.addEventListener('click', function(e) {
            // Allow default link behavior
            console.log('Navigating to:', this.href);
        });
    });
});