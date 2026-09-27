# BMAD Project UI

Interfaz web para leer y editar los archivos de un proyecto BMAD Method, revisar historias y épicas, y mantener conversaciones junto al texto. Los documentos del proyecto son la fuente de verdad.

El perfil estructurado implementado es **BMAD Method 6.12.0**. Las versiones o formatos no reconocidos conservan la lectura genérica y muestran sus límites. La aplicación no ejecuta agentes ni workflows de BMAD.

## Inicio local

Requisitos para desarrollar: Node.js 24 LTS y npm. La versión utilizada para los paquetes está fijada en `.node-version`.

```sh
npm ci
npm run dev
```

Abre `http://127.0.0.1:5173` en Chrome o Edge de escritorio y selecciona la **raíz de tu proyecto**. La primera apertura está en modo lectura. El botón **Activar Editor** solicita el permiso de escritura del navegador.

```sh
npm run check       # tipos, tests y compilación
npm run test:e2e    # recorridos de navegador; requiere Chromium de Playwright
```

Para preparar el navegador de las pruebas:

```sh
npx playwright install chromium
```

La compilación produce la web estática en `dist/web` y los conectores en `dist/connectors`. La web necesita HTTPS o localhost para utilizar File System Access. No necesita un servidor con acceso a los documentos. El servidor de desarrollo escucha exclusivamente en loopback.

## Trabajo con el proyecto

- **Documentos:** árbol de archivos, búsqueda, Markdown seguro, fuente, enlaces relativos y secciones. Las imágenes remotas no se cargan automáticamente.
- **Historias, épicas y sprint:** contenido y estados con su procedencia. El estado de sprint, el estado de ejecución y las casillas de tareas conservan sus significados independientes.
- **Edición:** un borrador compartido entre vista visual y fuente. Los cambios estructurados muestran los archivos afectados antes de aplicar. Guardar, commit y push son acciones separadas.
- **Comentarios:** hilos por fragmento, respuestas, reacciones, historial de edición propia y resolución. Se guardan en `.bmad-project-ui/comments/threads`, fuera de `_bmad-output`.
- **Catálogo:** agentes, skills y workflows declarados por la instalación, solo para consulta.
- **Diagnóstico:** configuración, cobertura parcial, formatos ambiguos, archivos ausentes y estados no reconocidos.

Todos los documentos compatibles pueden editarse, incluidos los derivados. La interfaz avisa cuando BMAD puede regenerar un archivo. No actualiza implícitamente `.memlog` ni inventa estados que no existen en los originales.

| Formato | Lectura y edición |
| --- | --- |
| Markdown | Vista renderizada, fuente y edición; HTML activo bloqueado. |
| YAML, TOML, JSON, CSV, TXT, MDX, HTML, XML | Fuente de texto UTF-8; proyecciones estructuradas solo cuando existe un adaptador. No ejecuta plantillas ni componentes. |
| PNG, JPEG, GIF, WebP | Imágenes referenciadas desde Markdown dentro de las raíces autorizadas, hasta 8 MiB; sin edición. |
| SVG, PDF y otros adjuntos | No se editan ni se ejecutan. El diagnóstico identifica su exclusión del inventario de texto. |

Los documentos de texto tienen un límite de 2 MiB por archivo, 32 MiB por inventario, 5.000 archivos y 20 niveles de profundidad. Un límite o fallo de lectura se muestra como cobertura parcial. Las rutas de secretos, herramientas, dependencias y repositorios anidados se excluyen.

## Conectores opcionales

Los conectores son procesos separados. La edición local y los comentarios funcionan sin ellos.

### Git

Necesita Git instalado en el sistema. Utiliza su identidad, firma, hooks y gestores de credenciales; revisa la confianza del repositorio antes de conectar.

```sh
npm run connector:git -- \
  --repo /ruta/al/proyecto \
  --origin http://127.0.0.1:5173 \
  --token-file /ruta/privada/fuera-del-proyecto/sesion-git
```

Carga el archivo de sesión desde **Conexión con Git**. La aplicación comprueba que el navegador y el conector trabajan sobre la misma carpeta. Puedes revisar un commit de archivos concretos, cambiar a una rama local existente y revisar todos los commits salientes antes de hacer push a una rama remota existente. No hay force push ni resolución de conflictos dentro de la aplicación.

Consulta [la guía del conector Git](docs/git-connector.md).

### Jira y Confluence

Cada servicio tiene su propio proceso, sesión, instancia, credenciales y ámbito. Los asistentes comprueban la identidad de la cuenta, el servicio y un recurso del ámbito antes de guardar la configuración. Los vínculos son explícitos y no crean recursos remotos.

Se implementan lectura, búsqueda, historial disponible, comparación por campos, propuestas exportables e importación local revisada. **La escritura remota de los perfiles actuales está bloqueada** cuando la API no puede garantizar la condición de concurrencia o la conservación de borradores requerida. Los tests con un adaptador atómico simulado verifican el flujo de publicación y recuperación; no certifican garantías de una cuenta real.

Consulta [configuración, perfiles y límites de Atlassian](docs/atlassian-connectors.md). No introduzcas credenciales del proveedor en la web ni en el repositorio.

Las bases de comparación verificadas se guardan en el almacenamiento privado del navegador, separadas de los vínculos versionados. Se recuperan al reabrir la misma asociación; cambiar su identidad invalida la base. Si ese almacenamiento no está disponible, la interfaz indica que la base solo dura durante la sesión.

## Paquetes con runtime incluido

```sh
npm run build:connectors
node scripts/package-connectors.mjs
node scripts/smoke-package.mjs
```

El empaquetado descarga el runtime oficial fijado y comprueba su SHA-256. Produce paquetes para el sistema y arquitectura de la ejecución. La CI construye y prueba paquetes en macOS, Windows y Linux. El instalador valida el contenido en una carpeta temporal antes de completar la instalación y no inicia servicios automáticamente.

Los paquetes son artefactos privados de GitHub Actions, sin firma ni notarización de distribución pública. No se deben confundir con una publicación firmada.

## Integridad y recuperación

El navegador comprueba la revisión del archivo antes de escribir, justo antes de cerrar el stream y después de guardar. Un cambio externo conserva el borrador y obliga a revisar. Las escrituras de la aplicación y las operaciones Git coordinan su exclusión entre pestañas del mismo origen mediante Web Locks.

Un guardado incompleto deja un registro de hashes en `.bmad-project-ui/local/write-recovery.json` y bloquea nuevas mutaciones. Las copias originales y previstas se mantienen en el filesystem privado del navegador cuando está disponible; la interfaz permite revisar el resultado antes de recuperar o aceptar el estado observado. Los registros privados locales no se pueden incluir en un commit mediante el conector.

Los borradores que todavía no se han guardado viven en la pestaña. Expórtalos antes de cerrar si necesitas conservarlos. El almacenamiento privado depende de ese navegador, perfil y origen: borrar sus datos elimina esas copias. Los cambios realizados por editores externos no participan en los Web Locks; las comprobaciones de revisión reducen las carreras, pero no equivalen a una transacción universal del filesystem.

La identidad de comentarios es local y declarada. No es una autenticación de equipo.

## Pruebas y alcance

Los tests cubren parsers, conservación de fuentes, comentarios, permisos y fallos de escritura, recuperación, Git nativo sobre repositorios temporales, transportes de proveedor y conectores HTTP. Los recorridos Playwright utilizan archivos reales de disco con un selector de carpeta sustituido únicamente en el driver de pruebas. La aceptación con el selector nativo es una verificación adicional, no una propiedad que ese driver pueda demostrar.

`tests/fixtures/huerto` contiene artefactos sintéticos originales para los contratos de BMAD 6.12.0. No representa usuarios, resultados ni trabajo real. Las pruebas no necesitan instalar BMAD ni invocar sus agentes.

No se incluyen ejecución de agentes, bases de datos autoritativas, migraciones automáticas de esquemas BMAD, resolución visual de conflictos, sincronización remota sin revisión ni compatibilidad universal con forks o versiones desconocidas.
