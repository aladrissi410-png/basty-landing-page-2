/* ============================================================
   BASTY — Luxury Scroll Experience
   High-performance canvas video scrubbing · Lenis smooth scroll

   Why canvas + a single-seek controller?
   ----------------------------------------------------------
   Setting video.currentTime on every scroll tick queues seeks
   faster than the decoder can present frames. The backlog makes
   the browser drop frames and stutter ("seek latency").

   Instead we:
     1) Drive ONE seek at a time (single-in-flight). A new seek is
        issued only after the previous frame is actually decoded
        (the 'seeked' event / requestVideoFrameCallback).
     2) Throttle issuance to ~30Hz — the eye reads scrubbing as
        smooth well below per-frame seeking, and the decoder never
        chokes.
     3) Paint each decoded frame onto a <canvas> we control, rather
        than relying on the <video> element's own repaint timing.
     4) Keep the canvas CONTAINED, not stretched: the backing store
        stays at the video's native 1280×720 and the element lives
        in a centered frame ≤ 860px wide. Downscaling keeps the
        image sharp and the composited area small, so scrubbing
        stays fast even on weak GPUs.
   The source MP4 is already Fast-Start + all-intra, so every seek
   is cheap and resolves quickly.
   ============================================================ */
(() => {
    "use strict";

    const docEl = document.documentElement;
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    const MIN_SPLASH = 450;
    const MAX_SPLASH = 2800;
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
       محرك السحب: ربط الفيديو بالتمرير عبر Canvas عالي الأداء
       ============================================================ */
    const track = document.getElementById("story");
    const stage = track ? track.querySelector(".stage") : null;
    const canvas = document.getElementById("story-canvas");
    const CHAPTERS = 5;

    if (motionOK && video && track && canvas && canvas.getContext) {

        const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
        const hasRVFC = typeof video.requestVideoFrameCallback === "function";

        // معدّل السحب: ~30 إطاراً/ث كافٍ بصرياً ويمنع اختناق فك التشفير
        const SEEK_HZ = 30;
        const SEEK_INTERVAL = 1000 / SEEK_HZ;
        const FRAME_DUR = 1 / 24; // الفيديو 24fps

        let scrubReady = false;
        let scrollTime = 0;   // الزمن المستهدف من التمرير
        let smoothTime = 0;   // زمن مُنعّم (lerp) لإحساس سلس عند التوقف
        let seeking = false;  // عملية بحث واحدة فقط قيد التنفيذ
        let lastSeekAt = 0;
        let drawnTime = -1;

        const sizeCanvas = () => {
            const w = video.videoWidth || 1280;
            const h = video.videoHeight || 720;
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
            }
        };

        const paint = () => {
            if (!video.videoWidth) return;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            drawnTime = video.currentTime;
        };

        const onFrameReady = () => {
            paint();
            seeking = false;
        };

        // 'seeked' هو الإشارة الموثوقة بأن الإطار فُكّ تشفيره وأصبح جاهزاً
        video.addEventListener("seeked", onFrameReady);

        // المضخّة: تُستدعى ضمن حلقة الرسم، لكنها تُصدر بحثاً واحداً مقيّداً بالمعدّل
        const pump = () => {
            if (!scrubReady) return;

            // تنعيم لطيف نحو هدف التمرير (إحساس زجاجي عند الاستقرار)
            smoothTime += (scrollTime - smoothTime) * 0.18;

            if (seeking) return;                                  // بحث واحد فقط في كل مرة
            if (performance.now() - lastSeekAt < SEEK_INTERVAL) return; // تقييد المعدّل
            if (Math.abs(smoothTime - drawnTime) < FRAME_DUR * 0.5) return; // قريب بما يكفي

            seeking = true;
            lastSeekAt = performance.now();
            video.currentTime = smoothTime;

            // rVFC: نرسم فور تقديم الإطار فعلياً (أدق من انتظار 'seeked' وحده)
            if (hasRVFC) {
                video.requestVideoFrameCallback(onFrameReady);
            }
        };

        const initScrub = () => {
            if (scrubReady || !video.duration) return;
            sizeCanvas();
            if (stage) stage.classList.add("canvas-on");
            video.pause();
            scrubReady = true;

            // ارسم الإطار الأول فور توفّره
            const firstFrame = () => paint();
            if (video.readyState >= 2) {
                video.currentTime = 0;
            } else {
                video.addEventListener("loadeddata", () => { video.currentTime = 0; }, { once: true });
            }
            video.addEventListener("seeked", firstFrame, { once: true });

            // اربط تقدّم التمرير بالزمن المستهدف فقط (دون أي بحث مباشر هنا)
            ScrollTrigger.create({
                trigger: track,
                start: "top top",
                end: "bottom bottom",
                scrub: true,
                onUpdate: (self) => {
                    scrollTime = self.progress * Math.max(0, video.duration - 0.05);
                }
            });

            // حلقة الرسم الموحّدة عبر مؤقّت GSAP
            gsap.ticker.add(pump);
        };

        if (video.readyState >= 1) {
            initScrub();
        } else {
            video.addEventListener("loadedmetadata", initScrub, { once: true });
        }

        // iOS/Safari: لمسة واحدة تفتح صلاحية فكّ إطارات الفيديو
        const unlockVideo = () => {
            const p = video.play();
            if (p && typeof p.then === "function") {
                p.then(() => video.pause()).catch(() => {});
            }
        };
        window.addEventListener("touchstart", unlockVideo, { once: true, passive: true });
        window.addEventListener("pointerdown", unlockVideo, { once: true });

        /* --- خط زمني للفصول: ظهور واختفاء متزامن مع التمرير --- */
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
                    const idx = Math.round(self.progress * (CHAPTERS - 1));
                    dots.forEach((d, i) => d.classList.toggle("is-active", i === idx));
                }
            }
        });

        const windows = [
            { in: null,          out: [0.05, 0.15] },
            { in: [0.17, 0.23],  out: [0.30, 0.36] },
            { in: [0.42, 0.48],  out: [0.55, 0.61] },
            { in: [0.67, 0.73],  out: [0.79, 0.85] },
            { in: [0.88, 0.96],  out: null }
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

        if (railFill) {
            tl.fromTo(railFill, { scaleY: 0 }, { scaleY: 1, duration: 1 }, 0);
        }

        /* --- نقاط القفز بين الفصول --- */
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

        // أعد ضبط أبعاد اللوحة عند تغيّر حجم النافذة
        window.addEventListener("resize", sizeCanvas, { passive: true });

    } else if (video) {
        // وضع الحركة المخفّضة: الإطار الأول كخلفية ثابتة (الفيديو ظاهر، بلا Canvas)
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

        window.addEventListener("load", () => ScrollTrigger.refresh());
    }
})();
