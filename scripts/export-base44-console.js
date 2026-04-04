/**
 * SCRIPT SIMPLIFICADO PARA CONSOLA DEL NAVEGADOR
 * ================================================
 *
 * 1. Abre tu app Base44 GESTIONCLIENTES en el navegador
 * 2. Inicia sesión como admin
 * 3. Abre DevTools → Console (F12)
 * 4. Pega EXACTAMENTE este código y presiona Enter
 * 5. Espera a que se descargue el JSON
 */

(async () => {
  const out = { exported_at: new Date().toISOString(), entities: {} };
  const names = ['Cliente','Zona','DocumentosCliente','PrescoringGALP','PlanPago','CuotaPago','TareaCorcho','Incidencia'];

  // Try to get the SDK from React internals
  let sdk;
  try {
    // Vite dev: dynamic import
    const mod = await import('/src/api/base44Client.js');
    sdk = mod.base44;
    console.log('✅ SDK encontrado via import');
  } catch(e) {
    console.log('Import directo no funciona, buscando en el DOM...');
  }

  if (!sdk) {
    // Try __VITE_HMR_RUNTIME__ or React fiber
    const root = document.getElementById('root');
    if (root?._reactRootContainer || root?.__reactFiber$) {
      console.log('Encontrado React root, intentando extraer SDK...');
    }
  }

  if (sdk) {
    for (const name of names) {
      try {
        console.log(`📦 ${name}...`);
        const data = await sdk.entities[name].list('-created_date');
        out.entities[name] = data;
        console.log(`  ✅ ${name}: ${data.length}`);
      } catch(e) { out.entities[name] = []; console.log(`  ⚠️ ${name}: ${e.message}`); }
    }
  } else {
    // Fallback: try fetching from Base44 API directly
    console.log('⚠️ SDK no accesible. Intentando API directa...');
    const origin = window.location.origin;

    for (const name of names) {
      try {
        console.log(`📦 ${name}...`);
        // Try multiple possible API patterns
        const urls = [
          `${origin}/api/entities/${name}/list?sort=-created_date&limit=10000`,
          `${origin}/api/v1/entities/${name}?sort=-created_date&limit=10000`,
        ];

        let success = false;
        for (const url of urls) {
          try {
            const r = await fetch(url, { credentials: 'include' });
            if (r.ok) {
              const d = await r.json();
              out.entities[name] = Array.isArray(d) ? d : (d.items || d.data || []);
              console.log(`  ✅ ${name}: ${out.entities[name].length}`);
              success = true;
              break;
            }
          } catch(e2) {}
        }
        if (!success) {
          out.entities[name] = [];
          console.log(`  ❌ ${name}: No se pudo acceder`);
        }
      } catch(e) { out.entities[name] = []; }
    }
  }

  // Download JSON
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'base44_export.json';
  a.click();

  console.log('\n📋 RESUMEN:');
  Object.entries(out.entities).forEach(([k,v]) => console.log(`  ${k}: ${v.length}`));
  console.log('\n✅ Descargado: base44_export.json');
  console.log('Colócalo en: voltis-crm/scripts/base44_export.json');
})();
