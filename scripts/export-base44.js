/**
 * BASE44 DATA EXPORT SCRIPT
 * =========================
 *
 * INSTRUCCIONES:
 * 1. Abre la app de Base44 (GESTIONCLIENTES) en tu navegador
 * 2. Inicia sesión como admin
 * 3. Abre la consola del navegador (F12 → Console)
 * 4. Copia y pega TODO este script
 * 5. Presiona Enter
 * 6. Se descargará un archivo JSON con todos los datos
 *
 * Entidades exportadas:
 * - Cliente (con suministros, facturas, eventos embebidos)
 * - Zona
 * - DocumentosCliente
 * - PrescoringGALP
 * - PlanPago
 * - CuotaPago
 * - TareaCorcho
 * - Incidencia
 */

(async function exportBase44Data() {
  console.log('🚀 Iniciando exportación de datos de Base44...');

  // Access the base44 SDK instance from the app's global scope
  // The app uses: import { base44 } from '@/api/base44Client'
  // We need to access the entities through the app's module system

  const entities = [
    'Cliente',
    'Zona',
    'DocumentosCliente',
    'PrescoringGALP',
    'PlanPago',
    'CuotaPago',
    'TareaCorcho',
    'Incidencia'
  ];

  const exportData = {
    exported_at: new Date().toISOString(),
    source: 'Base44 GESTIONCLIENTES',
    entities: {}
  };

  // Try to access base44 SDK from the app's React tree or window
  let sdk = null;

  // Method 1: Check if base44 is exposed on window
  if (window.base44) {
    sdk = window.base44;
  }

  // Method 2: Try to find it in the module cache (Vite)
  if (!sdk && window.__vite_plugin_react_preamble_installed__) {
    // Vite apps sometimes expose modules
    try {
      const modules = import.meta?.glob?.('/src/api/base44Client.js');
      if (modules) {
        const mod = await Object.values(modules)[0]();
        sdk = mod.base44;
      }
    } catch (e) {
      console.log('Vite module access failed, trying alternative...');
    }
  }

  // Method 3: Direct API calls using the app's configuration
  // Base44 uses REST-like API: GET /api/entities/{entityName}/list
  if (!sdk) {
    console.log('SDK not found directly, using API approach...');

    // Extract app config from the page
    const appId = document.querySelector('meta[name="app-id"]')?.content
      || localStorage.getItem('base44_app_id')
      || null;

    // Look for the app params in script tags or config
    let serverUrl = '';
    let token = '';

    // Try to get from URL params or localStorage
    const urlParams = new URLSearchParams(window.location.search);
    token = urlParams.get('access_token') || localStorage.getItem('base44_token') || '';

    // Try to extract from the app's JavaScript bundle
    const scripts = document.querySelectorAll('script[src]');

    console.log('⚠️  No se pudo acceder al SDK directamente.');
    console.log('Intentando método alternativo con fetch directo...');

    // The Base44 platform typically exposes its API at the same origin
    const baseUrl = window.location.origin;

    for (const entityName of entities) {
      try {
        console.log(`📦 Exportando ${entityName}...`);

        // Base44 SDK uses: entities.{Name}.list(sortField)
        // Which translates to: GET /api/entities/{name}/list?sort=-created_date
        const response = await fetch(`${baseUrl}/api/entities/${entityName}/list?sort=-created_date&limit=1000`, {
          headers: {
            'Content-Type': 'application/json',
            // Include any auth cookies that are already set
          },
          credentials: 'include'
        });

        if (response.ok) {
          const data = await response.json();
          exportData.entities[entityName] = Array.isArray(data) ? data : (data.items || data.data || [data]);
          console.log(`  ✅ ${entityName}: ${exportData.entities[entityName].length} registros`);
        } else {
          console.log(`  ⚠️  ${entityName}: Error ${response.status}`);
          exportData.entities[entityName] = [];
        }
      } catch (error) {
        console.log(`  ❌ ${entityName}: ${error.message}`);
        exportData.entities[entityName] = [];
      }
    }
  } else {
    // Use SDK directly
    for (const entityName of entities) {
      try {
        console.log(`📦 Exportando ${entityName}...`);
        const records = await sdk.entities[entityName].list('-created_date');
        exportData.entities[entityName] = records || [];
        console.log(`  ✅ ${entityName}: ${exportData.entities[entityName].length} registros`);
      } catch (error) {
        console.log(`  ⚠️  ${entityName}: ${error.message}`);
        exportData.entities[entityName] = [];
      }
    }
  }

  // Also try to get user list
  try {
    console.log('📦 Exportando Users...');
    if (sdk) {
      const users = await sdk.auth.list?.() || [];
      exportData.entities.Users = users;
    }
  } catch (e) {
    console.log('  ⚠️  Users: No se pudo exportar');
  }

  // Download as JSON
  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `base44_export_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log('');
  console.log('📋 RESUMEN DE EXPORTACIÓN:');
  console.log('========================');
  for (const [name, records] of Object.entries(exportData.entities)) {
    console.log(`  ${name}: ${records.length} registros`);
  }
  console.log('');
  console.log('✅ Archivo descargado: base44_export_' + new Date().toISOString().split('T')[0] + '.json');
  console.log('');
  console.log('SIGUIENTE PASO: Coloca el archivo JSON en la carpeta scripts/ del proyecto Voltis CRM');
  console.log('y ejecuta: node scripts/migrate-to-supabase.mjs');

  return exportData;
})();
