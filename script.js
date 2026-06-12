// تسجيل إضافة التمرير
gsap.registerPlugin(ScrollTrigger);

document.addEventListener("DOMContentLoaded", (event) => {
    const video = document.getElementById("bg-video");

    // تهيئة محرك Lenis للتمرير السلس جداً
    const lenis = new Lenis({
        duration: 1.2,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        wheelMultiplier: 0.9
    });

    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => { lenis.raf(time * 1000); });
    gsap.ticker.lagSmoothing(0);

    // ربط الفيديو بالتمرير بمجرد تحميل بياناته
    video.addEventListener('loadedmetadata', () => {
        let lastTime = -1;

        const scrubVideo = () => {
            if (!video.duration) return;
            
            // حساب نسبة التمرير في الصفحة من 0 إلى 1
            const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
            const scrollTop = window.scrollY;
            const progress = Math.min(1, Math.max(0, scrollTop / Math.max(1, scrollHeight)));
            
            // تحويل النسبة إلى ثوانٍ في الفيديو (طرح جزء بسيط لتجنب التوقف المفاجئ في النهاية)
            const targetTime = progress * (video.duration - 0.1);
            
            // تحديث إطار الفيديو فقط إذا كان هناك تغيير ملحوظ لتوفير موارد المعالج
            if (Math.abs(targetTime - lastTime) > 0.01) {
                video.currentTime = targetTime;
                lastTime = targetTime;
            }
        };

        // إيقاف التشغيل التلقائي وتفعيل الربط
        video.pause();
        video.currentTime = 0;

        ScrollTrigger.create({
            trigger: document.body,
            start: "top top",
            end: "bottom bottom",
            scrub: true,
            onUpdate: scrubVideo
        });
        
        // تشغيل الدالة مرة واحدة لضبط الإطار الأول
        scrubVideo();
    });
});
