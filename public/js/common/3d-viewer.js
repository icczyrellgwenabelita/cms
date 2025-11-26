/**
 * Unified Three.js 3D Model Viewer
 * Used by admin, student, and instructor portals
 */

/**
 * Renders a 3D model in a container using Three.js
 * @param {HTMLElement} container - Container element to render the model in
 * @param {string} modelUrl - URL of the 3D model to load
 * @param {string} modelType - Type of model (glb, gltf, fbx, obj)
 * @returns {Function} Cleanup function to dispose of the scene
 */
function renderToolModel(container, modelUrl, modelType) {
  if (!container || !modelUrl || !modelType) {
    console.error('renderToolModel: Missing required parameters');
    return () => {};
  }

  // Check if Three.js is available
  if (typeof THREE === 'undefined') {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: #DC2626;">Three.js library not loaded. Please refresh the page.</div>';
    return () => {};
  }

  // Clear previous content
  container.innerHTML = '<div style="padding: 20px; text-align: center; color: #64748B;"><div class="spinner" style="border: 3px solid #f3f3f3; border-top: 3px solid #C19A6B; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 10px;"></div>Loading 3D model...</div>';
  
  // Add spinner animation if not already in document
  if (!document.getElementById('spinner-style')) {
    const style = document.createElement('style');
    style.id = 'spinner-style';
    style.textContent = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }

  const lowerType = modelType.toLowerCase();
  const supportedTypes = ['glb', 'gltf', 'fbx', 'obj'];
  
  if (!supportedTypes.includes(lowerType)) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: #DC2626;">Unsupported 3D model type: ' + modelType + '</div>';
    return () => {};
  }

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  container.innerHTML = '';
  container.appendChild(canvas);

  // Setup scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f5);
  
  const width = container.clientWidth || 800;
  const height = container.clientHeight || 600;
  
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
  camera.position.set(0, 0, 5);
  
  const renderer = new THREE.WebGLRenderer({ 
    canvas: canvas, 
    antialias: true,
    alpha: false
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Add lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(5, 5, 5);
  directionalLight.castShadow = true;
  scene.add(directionalLight);
  
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
  fillLight.position.set(-5, 0, -5);
  scene.add(fillLight);

  // Orbit controls
  let controls = null;
  if (typeof THREE.OrbitControls !== 'undefined') {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 1;
    controls.maxDistance = 20;
  }

  let currentModel = null;
  let animationId = null;
  let mixer = null;
  let clock = new THREE.Clock();

  // Cleanup function
  const cleanup = () => {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    
    if (mixer) {
      mixer.stopAllAction();
      mixer = null;
    }
    
    if (currentModel) {
      scene.remove(currentModel);
      currentModel.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => {
                if (mat.dispose) mat.dispose();
                if (mat.map) mat.map.dispose();
              });
            } else {
              if (child.material.dispose) child.material.dispose();
              if (child.material.map) child.material.map.dispose();
            }
          }
        }
      });
      currentModel = null;
    }
    
    if (controls) {
      controls.dispose();
      controls = null;
    }
    
    renderer.dispose();
    clock = null;
  };

  // Handle resize
  const handleResize = () => {
    const newWidth = container.clientWidth || 800;
    const newHeight = container.clientHeight || 600;
    camera.aspect = newWidth / newHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(newWidth, newHeight);
  };

  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(container);

  // Auto-fit model to camera
  const fitModelToCamera = (model) => {
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2 / maxDim;
    model.scale.setScalar(scale);
    
    const boxCenter = new THREE.Vector3();
    box.getCenter(boxCenter);
    model.position.sub(boxCenter);
    
    // Adjust camera position
    const distance = maxDim * 2;
    camera.position.set(distance * 0.7, distance * 0.5, distance * 0.7);
    camera.lookAt(0, 0, 0);
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  };

  // Load success handler
  const onLoad = (object) => {
    // Remove previous model
    if (currentModel) {
      scene.remove(currentModel);
      currentModel.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => {
                if (mat.dispose) mat.dispose();
                if (mat.map) mat.map.dispose();
              });
            } else {
              if (child.material.dispose) child.material.dispose();
              if (child.material.map) child.material.map.dispose();
            }
          }
        }
      });
    }
    
    let model = object;
    if (object.scene) {
      model = object.scene;
    }
    
    // Check for animations
    if (object.animations && object.animations.length > 0) {
      mixer = new THREE.AnimationMixer(model);
      object.animations.forEach((clip) => {
        mixer.clipAction(clip).play();
      });
    }
    
    fitModelToCamera(model);
    scene.add(model);
    currentModel = model;
    
    // Start render loop
    const animate = () => {
      if (mixer) {
        mixer.update(clock.getDelta());
      }
      
      if (controls) {
        controls.update();
      }
      
      renderer.render(scene, camera);
      animationId = requestAnimationFrame(animate);
    };
    animate();
  };

  // Error handler
  const onError = (error) => {
    console.error('3D model load error:', error);
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: #DC2626;">Unable to load 3D model. Please check the file format and try again.</div>';
    cleanup();
  };

  // Validate loaders are available
  const validateLoader = (loaderName) => {
    if (typeof THREE === 'undefined') {
      console.error('THREE is undefined');
      return false;
    }
    
    if (typeof THREE[loaderName] === 'undefined') {
      console.error(`${loaderName} missing from THREE namespace`);
      
      // Try to attach from window if available
      if (typeof window[loaderName] !== 'undefined') {
        THREE[loaderName] = window[loaderName];
        console.log(`Attached ${loaderName} from window to THREE`);
        return true;
      }
      
      return false;
    }
    
    return true;
  };

  // Load model based on type
  try {
    if (lowerType === 'glb' || lowerType === 'gltf') {
      if (!validateLoader('GLTFLoader')) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #DC2626;">GLTFLoader not available. Please refresh the page and ensure Three.js loaders are loaded.</div>';
        cleanup();
        return cleanup;
      }
      const loader = new THREE.GLTFLoader();
      loader.load(modelUrl, onLoad, undefined, onError);
    } else if (lowerType === 'fbx') {
      if (!validateLoader('FBXLoader')) {
        console.error('FBXLoader missing - check that fflate and FBXLoader scripts are loaded before 3d-viewer.js');
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #DC2626;">FBXLoader not available. Please refresh the page and ensure Three.js loaders are loaded. Note: FBXLoader requires fflate dependency.</div>';
        cleanup();
        return cleanup;
      }
      const loader = new THREE.FBXLoader();
      loader.load(modelUrl, onLoad, undefined, onError);
    } else if (lowerType === 'obj') {
      if (!validateLoader('OBJLoader')) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #DC2626;">OBJLoader not available. Please refresh the page and ensure Three.js loaders are loaded.</div>';
        cleanup();
        return cleanup;
      }
      const loader = new THREE.OBJLoader();
      loader.load(modelUrl, onLoad, undefined, onError);
    }
  } catch (error) {
    console.error('Error loading 3D model:', error);
    onError(error);
  }

  // Return cleanup function
  return () => {
    resizeObserver.disconnect();
    cleanup();
  };
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderToolModel };
}

