// Script para automatizar la generación de recetas en RCTA a partir de archivos Excel
const puppeteer = require('puppeteer');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Función para interactuar con el usuario en la consola
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Configuración
const config = {
  rctaUrl: 'https://app.rcta.me/AddPrescription', // Reemplazar con la URL correcta
  descargarRecetas: true,
  carpetaDescargas: './recetas-generadas'
};

// Función principal
async function generarRecetas() {
  console.log('🔄 Iniciando proceso de generación de recetas...');
  
  // Pedir archivos Excel
  const pacientesPath = await preguntarUsuario('📂 Ingresa la ruta del archivo Excel de pacientes: ');
  const formulasPath = await preguntarUsuario('📂 Ingresa la ruta del archivo Excel de fórmulas: ');
  
  // Leer credenciales de RCTA
  const username = await preguntarUsuario('👤 Usuario de RCTA: ');
  const password = await preguntarUsuario('🔑 Contraseña de RCTA: ', true);
  
  try {
    // Procesar archivos Excel
    console.log('📊 Procesando archivos Excel...');
    const { pacientes, formulas } = procesarArchivosExcel(pacientesPath, formulasPath);
    console.log(`✅ Se encontraron ${pacientes.length} pacientes y ${formulas.length} fórmulas.`);
    
    // Iniciar navegador
    console.log('🌐 Iniciando navegador...');
    const browser = await puppeteer.launch({
      headless: false, // Mostrar navegador para depuración
      defaultViewport: null,
      args: ['--start-maximized']
    });
    
    const page = await browser.newPage();
    
    // Configurar carpeta de descargas
    if (config.descargarRecetas) {
      if (!fs.existsSync(config.carpetaDescargas)) {
        fs.mkdirSync(config.carpetaDescargas, { recursive: true });
      }
      
      const client = await page.target().createCDPSession();
      await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: path.resolve(config.carpetaDescargas)
      });
    }
    
    // Iniciar sesión en RCTA
    console.log('🔑 Iniciando sesión en RCTA...');
    await iniciarSesionRCTA(page, username, password);
    
    // Generar recetas para cada paciente
    console.log('📝 Comenzando generación de recetas...');
    
    let recetasGeneradas = 0;
    let recetasFallidas = 0;
    
    for (let i = 0; i < pacientes.length; i++) {
      const paciente = pacientes[i];
      console.log(`\n👤 Procesando paciente ${i+1}/${pacientes.length}: ${paciente.Paciente}`);
      
      try {
        // Navegar a la página de creación de recetas
        await page.goto('https://app.rcta.me/AddPrescription', { waitUntil: 'networkidle2' });
        
        // Completar datos del paciente
        await completarDatosPaciente(page, paciente);
        
        // Buscar la fórmula correspondiente
        const formulaId = paciente.Formula;
        const formulaDetalle = formulas.find(f => f.Nº == formulaId);
        
        if (!formulaDetalle) {
          console.log(`⚠️ No se encontró la fórmula ID ${formulaId} para el paciente ${paciente.Paciente}. Saltando...`);
          recetasFallidas++;
          continue;
        }
        
        // Generar texto de la receta
        let textoReceta = `${formulaDetalle.Detalle} X${paciente.Cantidad_comp}`;
        if (paciente.Nr_de_Frasco > 0) {
          textoReceta += ` ${paciente.Nr_de_Frasco})`; 
        }
        
        // Completar el campo de texto libre con la prescripción
        await completarPrescripcion(page, textoReceta);
        
        // Generar la receta
        await generarYDescargarReceta(page, paciente);
        
        recetasGeneradas++;
        console.log(`✅ Receta generada para ${paciente.Paciente} - ${paciente.Receta || 'Principal'}`);
        
        // Pequeña pausa para evitar sobrecargar el servidor
        await page.waitForTimeout(1000);
        
      } catch (error) {
        console.error(`❌ Error al generar receta para ${paciente.Paciente}:`, error.message);
        recetasFallidas++;
      }
    }
    
    console.log('\n📊 Resumen:');
    console.log(`✅ Recetas generadas exitosamente: ${recetasGeneradas}`);
    console.log(`❌ Recetas con errores: ${recetasFallidas}`);
    
    if (config.descargarRecetas) {
      console.log(`📁 Las recetas se han guardado en: ${path.resolve(config.carpetaDescargas)}`);
    }
    
    // Cerrar navegador
    await browser.close();
    console.log('🏁 Proceso finalizado.');
    
  } catch (error) {
    console.error('❌ Error general:', error);
  } finally {
    rl.close();
  }
}

// Función para procesar archivos Excel
function procesarArchivosExcel(pacientesPath, formulasPath) {
  // Procesar archivo de pacientes
  const pacientesWorkbook = XLSX.readFile(pacientesPath);
  const pacientesSheet = pacientesWorkbook.Sheets[pacientesWorkbook.SheetNames[0]];
  const pacientes = XLSX.utils.sheet_to_json(pacientesSheet);
  
  // Procesar archivo de fórmulas
  const formulasWorkbook = XLSX.readFile(formulasPath);
  const formulasSheet = formulasWorkbook.Sheets[formulasWorkbook.SheetNames[0]];
  const formulas = XLSX.utils.sheet_to_json(formulasSheet);
  
  return { pacientes, formulas };
}

// Función para iniciar sesión en RCTA
async function iniciarSesionRCTA(page, username, password) {
  await page.goto(config.rctaUrl, { waitUntil: 'networkidle2' });
  
  // Ingresar credenciales (ajustar selectores según la plataforma)
  await page.type('#username', username);
  await page.type('#password', password);
  
  // Hacer clic en el botón de inicio de sesión
  await Promise.all([
    page.click('#login-button'),
    page.waitForNavigation({ waitUntil: 'networkidle2' })
  ]);
  
  // Verificar si el inicio de sesión fue exitoso
  const currentUrl = page.url();
  if (currentUrl.includes('login') || currentUrl === config.rctaUrl) {
    throw new Error('Falló el inicio de sesión. Verifica las credenciales.');
  }
}

// Función para completar datos del paciente
async function completarDatosPaciente(page, paciente) {
  // Esta función debe adaptarse según la interfaz de RCTA
  // Los selectores CSS deben ajustarse según la estructura del sitio
  
  // Buscar y seleccionar al paciente
  await page.click('#buscar-paciente-btn');
  await page.waitForSelector('#modal-buscar-paciente');
  await page.type('#input-buscar-paciente', paciente.Paciente);
  await page.click('#btn-buscar');
  await page.waitForSelector('#resultado-busqueda');
  
  // Seleccionar el primer resultado (ajustar según sea necesario)
  await page.click('#tabla-resultados tr:first-child');
  
  // Esperar a que se carguen los datos del paciente
  await page.waitForSelector('#datos-paciente-cargados', { visible: true });
  
  // Si es necesario seleccionar tipo de receta (A, B, C, etc.)
  if (paciente.Receta) {
    await page.select('#tipo-receta', paciente.Receta);
  }
  
  // Seleccionar cobertura médica (según las imágenes, parece ser HOMINIS)
  await page.click('#cobertura-hominis');
}

// Función para completar la prescripción
async function completarPrescripcion(page, textoReceta) {
  // Hacer clic en la pestaña de texto libre
  await page.click('#tab-texto-libre');
  
  // Limpiar el campo si es necesario
  await page.evaluate(() => {
    document.querySelector('#campo-texto-libre').value = '';
  });
  
  // Ingresar el texto de la receta
  await page.type('#campo-texto-libre', textoReceta);
}

// Función para generar y descargar la receta
async function generarYDescargarReceta(page, paciente) {
  // Hacer clic en el botón de generar prescripción
  await Promise.all([
    page.click('#btn-generar-prescripcion'),
    page.waitForSelector('#receta-generada', { visible: true, timeout: 30000 })
  ]);
  
  if (config.descargarRecetas) {
    // Hacer clic en el botón de descargar PDF
    await Promise.all([
      page.click('#btn-descargar-pdf'),
      // Esperar a que se inicie la descarga
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
    
    // Opcional: renombrar el archivo descargado
    // Esto depende de cómo maneja las descargas la plataforma RCTA
  }
}

// Función para hacer preguntas al usuario
function preguntarUsuario(pregunta, esPassword = false) {
  return new Promise((resolve) => {
    if (esPassword) {
      // No mostrar la contraseña en la consola
      process.stdout.write(pregunta);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      let password = '';
      
      process.stdin.on('data', (char) => {
        char = char.toString();
        
        // Ctrl+C
        if (char === '\u0003') {
          process.exit();
        }
        
        // Enter
        if (char === '\r' || char === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          resolve(password);
          return;
        }
        
        // Backspace
        if (char === '\u0008' || char === '\u007f') {
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write('\b \b');
          }
          return;
        }
        
        // Añadir carácter a la contraseña
        password += char;
        process.stdout.write('*');
      });
    } else {
      rl.question(pregunta, (respuesta) => {
        resolve(respuesta);
      });
    }
  });
}

// Iniciar el proceso
generarRecetas();