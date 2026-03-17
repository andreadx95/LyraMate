import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

class Avatar {
    currentVrm: any = undefined;
    canvas: HTMLCanvasElement;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    scene: THREE.Scene
    controls: OrbitControls;
    clock: THREE.Clock;
    idleTime: number;
    isInitialPoseSet: boolean;
    // ========== ANIMATION STATE ==========
    currentAnimationState: string = "idle"; // idle, listening, speaking, thinking, grabbing
    previousAnimationState: string = "idle";
    animationTransitionTime: number = 0;
    animationTransitionDuration: number = 0.3; // 300ms di transizione smooth
    handObject: THREE.Object3D = null;
    handAnchor: THREE.Group = null;
    customTexture: THREE.Texture = null;

    constructor(avatar_canvas: string, VRM_MODEL_PATH: string, loadingDiv: HTMLElement) {

        this.canvas = document.getElementById(avatar_canvas) as HTMLCanvasElement;
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true,
        });
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        this.camera = new THREE.PerspectiveCamera(
            30.0,
            this.canvas.clientWidth / this.canvas.clientHeight,
            0.1,
            20.0,
        );
        this.camera.position.set(0.0, 0.35, 1.3);


        this.scene = new THREE.Scene();

        const light = new THREE.DirectionalLight(0xffffff, Math.PI);
        light.position.set(1.0, 1.0, 1.0).normalize();
        this.scene.add(light);


        // ========== VRM LOADING ==========
        const loader = new GLTFLoader();
        loader.crossOrigin = "anonymous";
        loader.register((parser) => new VRMLoaderPlugin(parser));

        loader.load(
            VRM_MODEL_PATH,
            (gltf) => {
                const vrm = gltf.userData.vrm;
                VRMUtils.removeUnnecessaryVertices(gltf.scene);
                VRMUtils.combineSkeletons(gltf.scene);
                VRMUtils.combineMorphs(vrm);

                vrm.scene.traverse((obj) => {
                    obj.frustumCulled = false;
                });

                this.currentVrm = vrm;
                this.scene.add(vrm.scene);
                loadingDiv.classList.add("hidden");
                console.log("VRM caricato!", vrm);
            },
            (progress) => {
                const percent = (100.0 * (progress.loaded / progress.total)).toFixed(
                    1,
                );
                loadingDiv.innerHTML = `<div>${percent}%</div><div class="spinner"></div>`;
            },
            (error) => {
                console.error("Errore caricamento VRM:", error);
                loadingDiv.innerHTML = `<div style="color: red;">Errore: ${error.message}</div>`;
            },
        );

        // ========== ANIMATION LOOP ==========
        this.clock = new THREE.Clock();
        this.clock.start();

        // Idle animation state
        this.idleTime = 0;
        this.isInitialPoseSet = false;


    }

    setAnimationState(newState) {
        if (this.currentAnimationState !== newState) {
            this.previousAnimationState = this.currentAnimationState;
            this.currentAnimationState = newState;
            this.animationTransitionTime = 0; // Resetta il timer di transizione
        }
    }

    // ========== ANIMATION FUNCTIONS ==========

    // ========== IDLE ANIMATION ==========
    updateIdleAnimation(humanoid, time) {

        this.removeObjectFromHand();
        // Respirazione naturale
        const breathCycle = Math.sin(time * 0.8) * 0.015;
        const chest = humanoid.getNormalizedBoneNode("chest");
        if (chest) {
            chest.position.y += breathCycle;
            chest.rotation.x = Math.sin(time * 0.8) * 0.01;
        }

        // Movimento testa - guarda in giro lentamente
        const head = humanoid.getNormalizedBoneNode("head");
        if (head) {
            head.rotation.y = Math.sin(time * 0.3) * 0.15;
            head.rotation.x = Math.cos(time * 0.25) * 0.08 - 0.05;
            head.rotation.z = Math.sin(time * 0.2) * 0.03;
        }

        // Spostamento del peso (sway naturale)
        const hips = humanoid.getNormalizedBoneNode("hips");
        if (hips) {
            hips.position.x = Math.sin(time * 0.4) * 0.02;
            hips.rotation.z = Math.sin(time * 0.4) * 0.02;
        }

        const leftUpperArm = humanoid.getNormalizedBoneNode("leftUpperArm");
        const rightUpperArm = humanoid.getNormalizedBoneNode("rightUpperArm");
        if (leftUpperArm) {
            leftUpperArm.rotation.z = -1.3 + Math.sin(time * 1.1) * 0.05;
            leftUpperArm.rotation.x = Math.sin(time * 1.8) * 0.05;
        }
        if (rightUpperArm) {
            rightUpperArm.rotation.z = 1.3 - Math.sin(time * 2 + Math.PI) * 0.05;
            rightUpperArm.rotation.x = Math.sin(time * 1.8 + Math.PI) * 0.05;
        }
        const leftLowerArm = humanoid.getNormalizedBoneNode("leftLowerArm");
        const rightLowerArm = humanoid.getNormalizedBoneNode("rightLowerArm");
        // Avambracci distesi
        if (leftLowerArm) {
            leftLowerArm.rotation.x = 0;
            leftLowerArm.rotation.z = 0 + Math.sin(time * 1.8) * 0;
        }
        if (rightLowerArm) {
            rightLowerArm.rotation.x = 0;
            rightLowerArm.rotation.z = 0 + Math.sin(time * 1.8 + Math.PI) * 0;
        }

        // Micro movimenti braccia
        const leftShoulder = humanoid.getNormalizedBoneNode("leftShoulder");
        const rightShoulder = humanoid.getNormalizedBoneNode("rightShoulder");
        if (leftShoulder) {
            leftShoulder.rotation.z = Math.sin(time * 0.5) * 0.02;
            leftShoulder.rotation.x = Math.sin(time * 0.5) * 0.02;
        }
        if (rightShoulder)
            rightShoulder.rotation.z = Math.sin(time * 0.5 + Math.PI) * 0.02;

        
    }

    // ========== LISTENING ANIMATION ==========
    updateListeningAnimation(humanoid, time) {
        // Testa leggermente inclinata, postura attenta
        const head = humanoid.getNormalizedBoneNode("head");
        if (head) {
            head.rotation.y = -0.1 + Math.sin(time * 0.5) * 0.05;
            head.rotation.x = -0.15;
            head.rotation.z = Math.sin(time * 0.3) * 0.02;
        }

        // Postura più eretta
        const spine = humanoid.getNormalizedBoneNode("spine");
        if (spine) {
            spine.rotation.x = -0.08 + Math.sin(time * 0.6) * 0.03;
        }

        // Occhi che seguono
        const leftEye = humanoid.getNormalizedBoneNode("leftEye");
        const rightEye = humanoid.getNormalizedBoneNode("rightEye");
        if (leftEye) leftEye.rotation.y = Math.sin(time * 1.2) * 0.2;
        if (rightEye) rightEye.rotation.y = Math.sin(time * 1.2) * 0.2;
    }

    // ========== SPEAKING ANIMATION ==========
    updateSpeakingAnimation(humanoid, time) {
        // Testa più dinamica durante parlato
        const head = humanoid.getNormalizedBoneNode("head");
        if (head) {
            head.rotation.y =
                Math.sin(time * 1.5) * 0.2 + Math.sin(time * 0.7) * 0.1;
            head.rotation.x = Math.sin(time * 1.2) * 0.12;
            head.rotation.z = Math.sin(time * 0.9) * 0.08;
        }

        // Braccia con gesti naturali
        const leftUpperArm = humanoid.getNormalizedBoneNode("leftUpperArm");
        const rightUpperArm = humanoid.getNormalizedBoneNode("rightUpperArm");
        const chest = humanoid.getNormalizedBoneNode("chest");

        if (leftUpperArm) {
            leftUpperArm.rotation.z = -1.3 + Math.sin(time * 2) * 0.12;
            leftUpperArm.rotation.x = Math.sin(time * 1.8) * 0.08;
        }
        if (rightUpperArm) {
            rightUpperArm.rotation.z = 1.3 - Math.sin(time * 2 + Math.PI) * 0.12;
            rightUpperArm.rotation.x = Math.sin(time * 1.8 + Math.PI) * 0.08;
        }

        // Corpo che si muove naturalmente
        if (chest) {
            chest.rotation.z = Math.sin(time * 1.3) * 0.15;
            chest.rotation.x = Math.sin(time * 1.1) * 0.08;
        }

        // Oscillazione delle spalle
        const leftShoulder = humanoid.getNormalizedBoneNode("leftShoulder");
        const rightShoulder = humanoid.getNormalizedBoneNode("rightShoulder");
        if (leftShoulder) leftShoulder.rotation.z = Math.sin(time * 1.5) * 0.08;
        if (rightShoulder)
            rightShoulder.rotation.z = -Math.sin(time * 1.5 + Math.PI) * 0.08;
    }

    // ========== GRABBING ANIMATION ==========
    updateGrabbingAnimation(humanoid, time) {
        // Mani tese in avanti come per afferrare qualcosa
        const head = humanoid.getNormalizedBoneNode("head");
        if (head) {
            head.rotation.x = 0.15; // guarda leggermente in basso
            head.rotation.y = Math.sin(time * 0.6) * 0.05;
            head.rotation.z = 0;
        }

        const leftUpperArm = humanoid.getNormalizedBoneNode("leftUpperArm");
        const rightUpperArm = humanoid.getNormalizedBoneNode("rightUpperArm");
        const leftLowerArm = humanoid.getNormalizedBoneNode("leftLowerArm");
        const rightLowerArm = humanoid.getNormalizedBoneNode("rightLowerArm");



        // Braccia sollevate in avanti
        if (leftUpperArm) {
            leftUpperArm.rotation.z = -1.4 + Math.sin(time * 1.5) * 0.03;
            leftUpperArm.rotation.x = -0.6 + Math.sin(time * 1.2) * 0.04;
        }
        if (rightUpperArm) {
            rightUpperArm.rotation.z = 1.4 - Math.sin(time * 1.5) * 0.03;
            rightUpperArm.rotation.x = -0.6 + Math.sin(time * 1.2 + Math.PI) * 0.04;
        }

        // Avambracci distesi
        if (leftLowerArm) {
            leftLowerArm.rotation.x = -1.15 + Math.sin(time * 1.8) * 0.03;
            leftLowerArm.rotation.z = -1 + Math.sin(time * 1.8) * 0.03;
        }
        if (rightLowerArm) {
            rightLowerArm.rotation.x = -1.15 + Math.sin(time * 1.8 + Math.PI) * 0.03;
            rightLowerArm.rotation.z = 1 + Math.sin(time * 1.8 + Math.PI) * 0.03;
        }

        // Dita aperte (mani tese)
        const leftHand = humanoid.getNormalizedBoneNode("leftHand");
        const rightHand = humanoid.getNormalizedBoneNode("rightHand");
        if (leftHand) {
            leftHand.rotation.x = -0.2 + Math.sin(time * 2.0) * 0.05;
        }
        if (rightHand) {
            rightHand.rotation.x = -0.2 + Math.sin(time * 2.0 + Math.PI) * 0.05;
        }

        // Corpo leggermente inclinato in avanti
        const chest = humanoid.getNormalizedBoneNode("chest");
        if (chest) {
            chest.rotation.x = -0.1 + Math.sin(time * 0.8) * 0.02;
        }

        const spine = humanoid.getNormalizedBoneNode("spine");
        if (spine) {
            spine.rotation.x = -0.08;
        }
    }

    // ========== THINKING ANIMATION ==========
    updateThinkingAnimation(humanoid, time) {
        // Testa inclinata nel riflettere
        const head = humanoid.getNormalizedBoneNode("head");
        if (head) {
            head.rotation.y = -0.3 + Math.sin(time * 0.4) * 0.1;
            head.rotation.x = 0.25 + Math.cos(time * 0.3) * 0.05;
            head.rotation.z = Math.sin(time * 0.25) * 0.05;
        }

        const rightUpperArm = humanoid.getNormalizedBoneNode("rightUpperArm");
        const rightLowerArm = humanoid.getNormalizedBoneNode("rightLowerArm");
 
        if (this.customTexture != null) {
            this.customTexture.flipY = false; // flips the texture vertically
            const plane = new THREE.Mesh(
                new THREE.PlaneGeometry(0.15, 0.15),
                            new THREE.MeshBasicMaterial({ 
                map: this.customTexture,
                side: THREE.DoubleSide
            })
            );
            this.addObjectToHand(plane);

                    if (rightUpperArm) {
            rightUpperArm.rotation.z = 1.4 - Math.sin(time * 1.5) * 0.03;
            rightUpperArm.rotation.x = -0.5 + Math.sin(time * 1.2 + Math.PI) * 0.04;
        }

        if (rightLowerArm) {
            rightLowerArm.rotation.x = -1.15 + Math.sin(time * 1.8 + Math.PI) * 0.03;
            rightLowerArm.rotation.z = 1.7 + Math.sin(time * 1.8 + Math.PI) * 0.03;
        }
        }
      




        // Corpo leggermente curvato
        const chest = humanoid.getNormalizedBoneNode("chest");
        if (chest) {
            chest.rotation.x = -0.1 + Math.sin(time * 0.3) * 0.05;
            chest.rotation.z = Math.sin(time * 0.25) * 0.03;
        }

        // Sway minimale
        const hips = humanoid.getNormalizedBoneNode("hips");
        if (hips) {
            hips.position.x = Math.sin(time * 0.2) * 0.01;
        }
    }

    // ========== UPDATE CHARACTER ANIMATION MASTER ==========
    updateCharacterAnimation(humanoid, deltaTime, time) {
        if (!humanoid) return;

        // Aggiorna timer di transizione
        if (this.animationTransitionTime < this.animationTransitionDuration) {
            this.animationTransitionTime += deltaTime;
        }

        const blendFactor = Math.min(
            this.animationTransitionTime / this.animationTransitionDuration,
            1.0
        );

        // Blink regolare
        if (this.currentVrm && this.currentVrm.expressionManager) {
            const blinkCycle = Math.sin(time * 2) * 0.5 + 0.5;
            if (blinkCycle > 0.85) {
                this.currentVrm.expressionManager.setValue(
                    "blink",
                    (blinkCycle - 0.85) / 0.15,
                );
            } else {
                this.currentVrm.expressionManager.setValue("blink", 0);
            }
        }

        // Durante la transizione, miscela le due animazioni
        if (blendFactor < 1.0) {
            // Crea una copia dello stato delle ossa prima dell'animazione precedente
            const skeletonState = {};

            // Esegui animazione precedente e salva lo stato
            this.captureSkeletonState(humanoid, skeletonState);
            switch (this.previousAnimationState) {
                case "idle":
                    this.updateIdleAnimation(humanoid, time);
                    break;
                case "listening":
                    this.updateListeningAnimation(humanoid, time);
                    break;
                case "speaking":
                    this.updateSpeakingAnimation(humanoid, time);
                    break;
                case "thinking":
                    this.updateThinkingAnimation(humanoid, time);
                    break;
                case "grabbing":
                    this.updateGrabbingAnimation(humanoid, time);
                    break;
            }
            const prevState = this.captureSkeletonState(humanoid, {});

            // Esegui animazione nuova
            switch (this.currentAnimationState) {
                case "idle":
                    this.updateIdleAnimation(humanoid, time);
                    break;
                case "listening":
                    this.updateListeningAnimation(humanoid, time);
                    break;
                case "speaking":
                    this.updateSpeakingAnimation(humanoid, time);
                    break;
                case "thinking":
                    this.updateThinkingAnimation(humanoid, time);
                    break;
                case "grabbing":
                    this.updateGrabbingAnimation(humanoid, time);
                    break;
            }
            const nextState = this.captureSkeletonState(humanoid, {});

            // Blend tra i due stati
            this.blendSkeletonStates(humanoid, prevState, nextState, blendFactor);
        } else {
            // Nessuna transizione, esegui solo animazione corrente
            switch (this.currentAnimationState) {
                case "idle":
                    this.updateIdleAnimation(humanoid, time);
                    break;
                case "listening":
                    this.updateListeningAnimation(humanoid, time);
                    break;
                case "speaking":
                    this.updateSpeakingAnimation(humanoid, time);
                    break;
                case "thinking":
                    this.updateThinkingAnimation(humanoid, time);
                    break;
                case "grabbing":
                    this.updateGrabbingAnimation(humanoid, time);
                    break;
            }
        }
    }

    // Helper per catturare lo stato dello scheletro
    captureSkeletonState(humanoid, state) {
        const bones = [
            "head",
            "neck",
            "chest",
            "spine",
            "hips",
            "leftShoulder",
            "rightShoulder",
            "leftUpperArm",
            "rightUpperArm",
            "leftLowerArm",
            "rightLowerArm",
            "leftHand",
            "rightHand",
            "leftEye",
            "rightEye",
        ];

        bones.forEach((boneName) => {
            const bone = humanoid.getNormalizedBoneNode(boneName);
            if (bone) {
                if (!state[boneName]) {
                    state[boneName] = {};
                }
                state[boneName].rotationX = bone.rotation.x;
                state[boneName].rotationY = bone.rotation.y;
                state[boneName].rotationZ = bone.rotation.z;
                state[boneName].positionX = bone.position.x;
                state[boneName].positionY = bone.position.y;
                state[boneName].positionZ = bone.position.z;
            }
        });

        return state;
    }

    // Helper per blendare due stati dello scheletro
    blendSkeletonStates(humanoid, fromState, toState, blend) {
        Object.keys(toState).forEach((boneName) => {
            const bone = humanoid.getNormalizedBoneNode(boneName);
            if (bone && fromState[boneName]) {
                // Blend rotazioni
                bone.rotation.x =
                    fromState[boneName].rotationX +
                    (toState[boneName].rotationX - fromState[boneName].rotationX) *
                    blend;
                bone.rotation.y =
                    fromState[boneName].rotationY +
                    (toState[boneName].rotationY - fromState[boneName].rotationY) *
                    blend;
                bone.rotation.z =
                    fromState[boneName].rotationZ +
                    (toState[boneName].rotationZ - fromState[boneName].rotationZ) *
                    blend;

                // Blend posizioni
                bone.position.x =
                    fromState[boneName].positionX +
                    (toState[boneName].positionX - fromState[boneName].positionX) *
                    blend;
                bone.position.y =
                    fromState[boneName].positionY +
                    (toState[boneName].positionY - fromState[boneName].positionY) *
                    blend;
                bone.position.z =
                    fromState[boneName].positionZ +
                    (toState[boneName].positionZ - fromState[boneName].positionZ) *
                    blend;
            }
        });
    }

    // Funzione per impostare posa iniziale naturale
    setNaturalPose() {
        if (!this.currentVrm || !this.currentVrm.humanoid) return;

        const humanoid = this.currentVrm.humanoid;

        // Braccia lungo i fianchi (non T-pose)
        const leftUpperArm = humanoid.getNormalizedBoneNode("leftUpperArm");
        const rightUpperArm = humanoid.getNormalizedBoneNode("rightUpperArm");
        const leftLowerArm = humanoid.getNormalizedBoneNode("leftLowerArm");
        const rightLowerArm = humanoid.getNormalizedBoneNode("rightLowerArm");

        if (leftUpperArm) {
            leftUpperArm.rotation.z = -1.2;   // abbassa da T
            leftUpperArm.rotation.x = 0.15;   // leggermente avanti
        }

        if (rightUpperArm) {
            rightUpperArm.rotation.z = 1.2;
            rightUpperArm.rotation.x = 0.15;
        }

        if (leftLowerArm) {
            leftLowerArm.rotation.x = -0.25;  // piega morbida
        }

        if (rightLowerArm) {
            rightLowerArm.rotation.x = -0.25;
        }


        // Postura rilassata
        const spine = humanoid.getNormalizedBoneNode("spine");
        if (spine) {
            spine.rotation.x = -0.05; // Leggermente inclinata avanti
        }

        const hips = humanoid.getNormalizedBoneNode("hips");
        if (hips) {
            hips.position.y = 0; // Abbassa leggermente
        }
        this.isInitialPoseSet = true;
    }

    addObjectToHand(object) {
        if (!this.currentVrm || !this.currentVrm.humanoid) return;
        // Clean up any existing hand object first to prevent orphaned scene nodes
        this.removeObjectFromHand();
        const rightHandRaw = this.currentVrm.humanoid.getRawBoneNode("rightHand");
        if (rightHandRaw) {
            this.handAnchor = new THREE.Group();
            rightHandRaw.add(this.handAnchor);

            // move anchor to palm area
            this.handAnchor.position.set(0, -0.03, 0.08);
            this.handAnchor.rotation.set(0, 0, 0);
            this.handObject = object;
            this.handAnchor.add(this.handObject);

            // orient object relative to palm
            object.rotation.x = -Math.PI / 2;
        }
    }

    removeObjectFromHand() {
        if (!this.currentVrm || !this.currentVrm.humanoid) return;
        if (!this.handAnchor) return;
        const rightHandRaw = this.currentVrm.humanoid.getRawBoneNode("rightHand");
        if (rightHandRaw) {
            // Dispose geometry and material to free GPU memory
            if (this.handObject) {
                if (this.handObject.geometry) this.handObject.geometry.dispose();
                if (this.handObject.material) this.handObject.material.dispose();
            }
            rightHandRaw.remove(this.handAnchor);
            this.handAnchor = null;
            this.handObject = null;
        }
    }

    doLipSync(text, audioPlayer) {
        if (!this.currentVrm || !this.currentVrm.expressionManager) return;

        // Viseme mapping for now italian testing, can be expanded for better accuracy
        const visemeMap = {
            a: "aa",
            e: "ih",
            i: "ih",
            o: "oh",
            u: "oh",
            m: "m",
            p: "pptbk",
            b: "pptbk",
            t: "tt",
            d: "tt",
            k: "pptbk",
            g: "pptbk",
            f: "ff",
            v: "ff",
            s: "ss",
            z: "ss",
            l: "ll",
            r: "rr",
            n: "nn",
        };

        // Estrai i visemi dal testo
        const visemes = [];
        for (let char of text.toLowerCase()) {
            const viseme = visemeMap[char];
            if (viseme) {
                visemes.push(viseme);
            }
        }

        if (visemes.length === 0) return;

        // Durata basata su: testo più lungo = più tempo per pronunciare
        const estimatedDuration = Math.max(
            text.length * 60,
            audioPlayer && audioPlayer.duration
                ? audioPlayer.duration * 1000
                : text.length * 60
        );
        const timePerViseme = estimatedDuration / visemes.length;

        let currentIndex = 0;
        let elapsed = 0;

        const lipSyncInterval = setInterval(() => {
            if (!this.currentVrm || !this.currentVrm.expressionManager) {
                clearInterval(lipSyncInterval);
                return;
            }

            if (elapsed >= estimatedDuration || currentIndex >= visemes.length) {
                clearInterval(lipSyncInterval);
                // Chiudi tutte le espressioni bocca
                this.currentVrm.expressionManager.setValue("aa", 0);
                this.currentVrm.expressionManager.setValue("ih", 0);
                this.currentVrm.expressionManager.setValue("oh", 0);
                this.currentVrm.expressionManager.setValue("m", 0);
                this.currentVrm.expressionManager.setValue("pptbk", 0);
                this.currentVrm.expressionManager.setValue("tt", 0);
                this.currentVrm.expressionManager.setValue("ff", 0);
                this.currentVrm.expressionManager.setValue("ss", 0);
                this.currentVrm.expressionManager.setValue("ll", 0);
                this.currentVrm.expressionManager.setValue("rr", 0);
                this.currentVrm.expressionManager.setValue("nn", 0);
                return;
            }

            // Ogni visema ha una durata proporzionale
            const progressInViseme = (elapsed % timePerViseme) / timePerViseme;
            const currentViseme =
                visemes[Math.floor(elapsed / timePerViseme) % visemes.length];

            // Animazione naturale: attacco, picco, decadimento
            let value;
            if (progressInViseme < 0.3) {
                // Attacco rapido
                value = progressInViseme / 0.3;
            } else if (progressInViseme < 0.7) {
                // Plateau
                value = 1.0;
            } else {
                // Decadimento graduale
                value = 1.0 - (progressInViseme - 0.7) / 0.3;
            }

            // Aggiungi legge vibrazione naturale
            value += Math.sin(elapsed / 50) * 0.05;
            value = Math.max(0, Math.min(1, value));

            // Resetta tutti i visemi
            this.currentVrm.expressionManager.setValue("aa", 0);
            this.currentVrm.expressionManager.setValue("ih", 0);
            this.currentVrm.expressionManager.setValue("oh", 0);
            this.currentVrm.expressionManager.setValue("m", 0);
            this.currentVrm.expressionManager.setValue("pptbk", 0);
            this.currentVrm.expressionManager.setValue("tt", 0);
            this.currentVrm.expressionManager.setValue("ff", 0);
            this.currentVrm.expressionManager.setValue("ss", 0);
            this.currentVrm.expressionManager.setValue("ll", 0);
            this.currentVrm.expressionManager.setValue("rr", 0);
            this.currentVrm.expressionManager.setValue("nn", 0);

            // Attiva il visema corrente
            if (currentViseme) {
                this.currentVrm.expressionManager.setValue(currentViseme, value);
            }

            elapsed += 16; // ~60fps
        }, 16);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const deltaTime = this.clock.getDelta();
        this.idleTime += deltaTime;

        if (this.currentVrm) {
            // Imposta posa iniziale una volta
            if (!this.isInitialPoseSet) {
                this.setNaturalPose();
            }

            // Aggiorna animazioni del personaggio PRIMA di vrm.update()
            // così i transform normalizzati vengono copiati ai raw bone nello stesso frame
            if (this.currentVrm.humanoid) {
                this.updateCharacterAnimation(this.currentVrm.humanoid, deltaTime, this.idleTime);
            }

            this.currentVrm.update(deltaTime);
        }

        this.renderer.render(this.scene, this.camera);
    }
}
export default Avatar;