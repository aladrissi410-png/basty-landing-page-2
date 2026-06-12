/* ============================================================
   BASTY — Luxury Scroll Experience
   GSAP + ScrollTrigger video scrubbing · Lenis smooth scroll
   ============================================================ */
(() => {
    "use strict";

    const docEl = document.documentElement;
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // في حال تفضيل تقليل الحركة أو فشل تحميل GSAP: نعود للتخطيط الثابت الكامل
    const gsapReady = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";
    const motionOK = gsapReady && !prefersReduced;

    if (!motionOK) {
        docEl.classList.add("reduced-motion");
    }

    if (gsapReady) {
        gsap.registerPlugin(ScrollTrigger);
    }

    /* ---------- شاشة التحميل ---------- */
    const video = document.getElementById("bg-video");
    const MIN_SPLASH = 450;   // أقل مدة عرض لتجنب الوميض
    const MAX_SPLASH = 2800;  // مهلة قصوى حتى لو تأخر الفيديو
    const splashStart = performance.now();
    let splashDone = false;

    const hideSplash = () => {
        if (splashDone) return;
        splashDone = true;
        const elapsed = performance.now() - splashStart;
        window.setTimeout(() => {
            document.body.classList.add("is-ready");
            const pre = document.getElementById("preloader");
            if (pre) pre.setAttribute("aria-hidden", "true");
        }, Math.max(0, MIN_SPLASH - elapsed));
    };

    if (video && video.readyState >= 1) {
        hideSplash();
    } else if (video) {
        video.addEventListener("loadedmetadata", hideSplash, { once: true });
    }
    window.addEventListener("load", hideSplash, { once: true });
    window.setTimeout(hideSplash, MAX_SPLASH);

    /* ---------- Lenis: تمرير سلس فاخر ---------- */
    let lenis = null;
    if (motionOK && typeof window.Lenis !== "undefined") {
        lenis = new Lenis({
            duration: 1.2,
            easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
            smoothWheel: true,
            wheelMultiplier: 0.9
        });
        lenis.on("scroll", ScrollTrigger.update);
        gsap.ticker.add((time) => lenis.raf(time * 1000));
        gsap.ticker.lagSmoothing(0);
    }

    const NAV_OFFSET = 88;

    // تمرير سلس نحو هدف (مع احتساب ارتفاع شريط التنقل)
    const scrollToTarget = (target) => {
        if (lenis) {
            lenis.scrollTo(target, { offset: -NAV_OFFSET });
        } else if (typeof target === "number") {
            window.scrollTo({ top: target - NAV_OFFSET, behavior: prefersReduced ? "auto" : "smooth" });
        } else {
            const el = typeof target === "string" ? document.querySelector(target) : target;
            if (el) {
                const top = el.getBoundingClientRect().top + window.scrollY - NAV_OFFSET;
                window.scrollTo({ top, behavior: prefersReduced ? "auto" : "smooth" });
            }
        }
    };

    /* ---------- شريط التنقل ---------- */
    const nav = document.getElementById("nav");
    const setNavState = () => {
        if (nav) nav.classList.toggle("is-scrolled", window.scrollY > 40);
    };
    setNavState();
    window.addEventListener("scroll", setNavState, { passive: true });

    /* ---------- قائمة الجوال ---------- */
    const navToggle = document.getElementById("nav-toggle");
    const mobileMenu = document.getElementById("mobile-menu");

    const setMenu = (open) => {
        document.body.classList.toggle("menu-open", open);
        if (navToggle) {
            navToggle.setAttribute("aria-expanded", String(open));
            navToggle.setAttribute("aria-label", open ? "إغلاق القائمة" : "فتح القائمة");
        }
        if (lenis) open ? lenis.stop() : lenis.start();
        document.body.style.overflow = open ? "hidden" : "";
    };

    if (navToggle) {
        navToggle.addEventListener("click", () => {
            setMenu(!document.body.classList.contains("menu-open"));
        });
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && document.body.classList.contains("menu-open")) {
            setMenu(false);
            if (navToggle) navToggle.focus();
        }
    });

    /* ---------- الروابط الداخلية ---------- */
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener("click", (e) => {
            const id = link.getAttribute("href");
            if (!id || id === "#") return;
            const target = document.querySelector(id);
            if (!target) return;
            e.preventDefault();
            if (document.body.classList.contains("menu-open")) setMenu(false);
            scrollToTarget(target);
        });
    });

    /* ============================================================
       قصة التجميع: ربط الفيديو بالتمرير (Scrubbing)
       ============================================================ */
    const track = document.getElementById("story");
    const CHAPTERS = 5;

    if (motionOK && video && track) {

        /* --- 1) تحريك إطارات الفيديو بنعومة (lerp) ---
           بدلاً من تعيين currentTime مباشرة عند كل حدث تمرير،
           نقترب من الزمن الهدف تدريجياً في كل إطار رسم،
           فيظهر الفيديو وكأنه يُسحب بسلاسة زجاجية. */
        let targetTime = 0;
        let smoothTime = 0;
        let lastApplied = -1;
        let videoReady = false;

        const initScrub = () => {
            if (videoReady || !video.duration) return;
            videoReady = true;
            video.pause();
            video.currentTime = 0;

            ScrollTrigger.create({
                trigger: track,
                start: "top top",
                end: "bottom bottom",
                scrub: true,
                onUpdate: (self) => {
                    targetTime = self.progress * Math.max(0, video.duration - 0.08);
                }
            });

            gsap.ticker.add(() => {
                const delta = targetTime - smoothTime;
                if (Math.abs(delta) < 0.001) return;
                smoothTime = Math.abs(delta) < 0.02 ? targetTime : smoothTime + delta * 0.14;
                // لا نطلب إطاراً جديداً إلا عند فرق ملموس (~إطار واحد)
                if (Math.abs(smoothTime - lastApplied) > 0.016) {
                    video.currentTime = smoothTime;
                    lastApplied = smoothTime;
                }
            });
        };

        if (video.readyState >= 1) {
            initScrub();
        } else {
            video.addEventListener("loadedmetadata", initScrub, { once: true });
        }

        // iOS/Safari: لمسة واحدة تكفي لفتح صلاحية التحكم بإطارات الفيديو
        const unlockVideo = () => {
            const p = video.play();
            if (p && typeof p.then === "function") {
                p.then(() => video.pause()).catch(() => {});
            }
        };
        window.addEventListener("touchstart", unlockVideo, { once: true, passive: true });
        window.addEventListener("pointerdown", unlockVideo, { once: true });

        /* --- 2) خط زمني للفصول: ظهور واختفاء متزامن مع التمرير ---
           كل فصل يدخل، يثبت عند مركز مقطعه (i/4)، ثم يغادر. */
        const chapters = gsap.utils.toArray(".chapter");
        const railFill = document.getElementById("rail-fill");
        const dots = gsap.utils.toArray(".rail-dot");

        const tl = gsap.timeline({
            defaults: { ease: "none" },
            scrollTrigger: {
                trigger: track,
                start: "top top",
                end: "bottom bottom",
                scrub: true,
                onUpdate: (self) => {
                    // مزامنة النقطة النشطة في مؤشر التقدم
                    const idx = Math.round(self.progress * (CHAPTERS - 1));
                    dots.forEach((d, i) => d.classList.toggle("is-active", i === idx));
                }
            }
        });

        // نوافذ العرض لكل فصل على مدى تقدّم 0 → 1
        const windows = [
            { in: null,          out: [0.05, 0.15] },   // البطل: ظاهر منذ البداية
            { in: [0.17, 0.23],  out: [0.30, 0.36] },
            { in: [0.42, 0.48],  out: [0.55, 0.61] },
            { in: [0.67, 0.73],  out: [0.79, 0.85] },
            { in: [0.88, 0.96],  out: null }            // الختام: يبقى حتى النهاية
        ];

        chapters.forEach((chapter, i) => {
            const w = windows[i];
            if (w.in) {
                tl.fromTo(chapter,
                    { autoAlpha: 0, y: 56 },
                    { autoAlpha: 1, y: 0, duration: w.in[1] - w.in[0] },
                    w.in[0]
                );
            }
            if (w.out) {
                tl.to(chapter,
                    { autoAlpha: 0, y: -56, duration: w.out[1] - w.out[0] },
                    w.out[0]
                );
            }
        });

        // تعبئة خط التقدم الذهبي
        if (railFill) {
            tl.fromTo(railFill, { scaleY: 0 }, { scaleY: 1, duration: 1 }, 0);
        }

        /* --- 3) نقاط القفز بين الفصول --- */
        const jumpTo = (i) => {
            const trackTop = track.getBoundingClientRect().top + window.scrollY;
            const runway = track.scrollHeight - window.innerHeight;
            const y = trackTop + runway * (i / (CHAPTERS - 1));
            if (lenis) {
                lenis.scrollTo(y);
            } else {
                window.scrollTo({ top: y, behavior: "smooth" });
            }
        };

        dots.forEach((dot) => {
            dot.addEventListener("click", () => {
                jumpTo(Number(dot.dataset.jump) || 0);
            });
        });

    } else if (video) {
        // وضع الحركة المخفّضة: نعرض الإطار الأول كخلفية ثابتة
        const freezeFrame = () => {
            video.pause();
            video.currentTime = 0;
        };
        if (video.readyState >= 1) freezeFrame();
        else video.addEventListener("loadedmetadata", freezeFrame, { once: true });
    }

    /* ---------- ظهور الأقسام السفلية ---------- */
    if (motionOK) {
        const revealEls = gsap.utils.toArray("[data-reveal]");
        gsap.set(revealEls, { autoAlpha: 0, y: 28 });

        const reveal = (batch) => {
            gsap.to(batch, {
                autoAlpha: 1,
                y: 0,
                duration: 0.9,
                ease: "expo.out",
                stagger: 0.08,
                overwrite: true
            });
        };

        ScrollTrigger.batch(revealEls, {
            start: "top 88%",
            once: true,
            onEnter: reveal,
            onEnterBack: reveal
        });

        // إعادة الحساب بعد اكتمال تحميل الصور
        window.addEventListener("load", () => ScrollTrigger.refresh());
    }
})();
