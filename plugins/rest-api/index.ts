/**
 * ============================================================
 * REST API Plugin - Main Entry Point
 * 
 * A comprehensive REST API for external system integration.
 * Enables clients to trigger calls, manage campaigns, and 
 * receive events via webhooks programmatically.
 * 
 * Installation:
 * 1. Import and register routes in your main server file
 * 2. Run database migrations for api_keys and api_audit_logs tables
 * 3. Add API Settings UI component to user settings page
 * 
 * See REST-API-PLUGIN.md for detailed documentation.
 * ============================================================
 */

import { Router, type Express, type RequestHandler } from 'express';
import YAML from 'yamljs';
import swaggerUi from 'swagger-ui-express';
import path from 'path';

// Routes
import callsRoutes from './routes/calls.routes.js';
import campaignsRoutes from './routes/campaigns.routes.js';
import agentsRoutes from './routes/agents.routes.js';
import contactsRoutes from './routes/contacts.routes.js';
import creditsRoutes from './routes/credits.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import webhooksRoutes from './routes/webhooks.routes.js';
import apiKeysRoutes from './routes/api-keys.routes.js';
import adminApiKeysRoutes from './routes/admin.routes.js';

// Service registry for dependency injection
import { setCallServices, type CallServices } from './service-registry.js';

// Services and Middleware
export { ApiKeyService } from './services/api-key.service.js';
export { apiAuthMiddleware, requireScope, asyncHandler } from './middleware/auth.middleware.js';

// Types
export * from './types.js';

// API Version
export const API_VERSION = 'v1';
export const API_BASE_PATH = `/api/${API_VERSION}`;

/**
 * Create the main REST API router with all endpoints
 */
export function createRestApiRouter(): Router {
  const router = Router();
  
  // Mount all API routes
  router.use('/calls', callsRoutes);
  router.use('/campaigns', campaignsRoutes);
  router.use('/agents', agentsRoutes);
  router.use('/contacts', contactsRoutes);
  router.use('/credits', creditsRoutes);
  router.use('/analytics', analyticsRoutes);
  router.use('/webhooks', webhooksRoutes);
  
  // Health check endpoint (no auth required)
  router.get('/health', (req, res) => {
    res.json({
      success: true,
      data: {
        status: 'healthy',
        version: API_VERSION,
        timestamp: new Date().toISOString(),
      },
    });
  });
  
  // API info endpoint (no auth required)
  router.get('/', (req, res) => {
    res.json({
      success: true,
      data: {
        name: 'AgentLabs REST API',
        version: API_VERSION,
        documentation: '/api/v1/docs',
        endpoints: {
          calls: '/api/v1/calls',
          campaigns: '/api/v1/campaigns',
          agents: '/api/v1/agents',
          contacts: '/api/v1/contacts',
          credits: '/api/v1/credits',
          analytics: '/api/v1/analytics',
          webhooks: '/api/v1/webhooks',
        },
        authentication: {
          type: 'API Key',
          header: 'Authorization: Bearer <api_key>',
          alternativeHeader: 'X-API-Key: <api_key>',
        },
      },
    });
  });
  
  return router;
}

/**
 * Options for registering REST API routes
 */
interface RegisterRestApiOptions {
  sessionAuthMiddleware: RequestHandler;
  adminAuthMiddleware: RequestHandler;
  callServices?: CallServices;
}

/**
 * Register REST API routes on an Express app
 * 
 * @param app Express application instance
 * @param options Configuration options including session auth middleware
 * @example
 * import { registerRestApiRoutes } from './plugins/rest-api';
 * registerRestApiRoutes(app, { sessionAuthMiddleware: authenticateToken, adminAuthMiddleware: checkAdmin });
 */
export function registerRestApiRoutes(app: Express, options: RegisterRestApiOptions): void {
  if (options.callServices) {
    setCallServices(options.callServices);
  }

  // Register main API routes at /api/v1
  app.use(API_BASE_PATH, createRestApiRouter());
  
  // Register API key management routes at /api/user/api-keys
  // These use session auth (not API key auth)
  app.use('/api/user/api-keys', options.sessionAuthMiddleware, apiKeysRoutes);
  
  // Register admin API key management routes (requires both session auth and admin role)
  app.use('/api/admin/api-keys', options.sessionAuthMiddleware, options.adminAuthMiddleware, adminApiKeysRoutes);
  
  // Setup Redoc for professional API documentation with sidebar navigation
  // Publicly accessible - no authentication required
  try {
    // Use project root (process.cwd()) to find the docs folder
    // This works in both development and production (compiled to dist/)
    const specPath = path.join(process.cwd(), 'plugins', 'rest-api', 'docs', 'openapi.yaml');
    const openApiDocument = YAML.load(specPath);

    // Serve OpenAPI spec as JSON for Redoc
    app.get('/api/docs/openapi.json', (_req, res) => {
      res.json(openApiDocument);
    });

    // Serve custom Redoc page with Stripe-like clean design
    app.get('/api/docs', (_req, res) => {
      res.type('html').send(`<!doctype html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AgentLabs API Reference</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
    <style>
      :root {
        --bg: #ffffff;
        --text: #0a2540;
        --text-secondary: #425466;
        --border: #e3e8ee;
        --sidebar-bg: #f6f9fc;
        --accent: #635bff;
        --code-bg: #0a2540;
      }
      html[data-theme="dark"] {
        --bg: #0a0a0a;
        --text: #f6f9fc;
        --text-secondary: #a3acb9;
        --border: #2a2a2a;
        --sidebar-bg: #111111;
        --accent: #7c75ff;
        --code-bg: #1a1a1a;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: var(--bg);
        color: var(--text);
        -webkit-font-smoothing: antialiased;
      }
      .header {
        position: sticky;
        top: 0;
        z-index: 100;
        background: var(--bg);
        border-bottom: 1px solid var(--border);
        padding: 0 24px;
        height: 64px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .header-left {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .logo {
        display: flex;
        align-items: center;
        gap: 8px;
        text-decoration: none;
        color: var(--text);
      }
      .logo-text {
        font-size: 15px;
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      .logo-api {
        font-size: 13px;
        font-weight: 500;
        color: var(--accent);
        padding: 2px 8px;
        background: rgba(99, 91, 255, 0.1);
        border-radius: 4px;
        margin-left: 4px;
      }
      .version {
        font-size: 12px;
        color: var(--text-secondary);
        padding: 3px 8px;
        background: var(--sidebar-bg);
        border: 1px solid var(--border);
        border-radius: 4px;
      }
      .header-right {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .playground-btn {
        font-size: 13px;
        font-weight: 500;
        color: var(--text);
        padding: 8px 16px;
        background: var(--sidebar-bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        text-decoration: none;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: background 0.15s, border-color 0.15s;
      }
      .playground-btn:hover {
        background: var(--accent);
        color: white;
        border-color: var(--accent);
      }
      .playground-btn svg {
        width: 16px;
        height: 16px;
      }
      .theme-toggle {
        width: 36px;
        height: 36px;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: var(--bg);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s, border-color 0.15s;
      }
      .theme-toggle:hover {
        background: var(--sidebar-bg);
        border-color: var(--text-secondary);
      }
      .theme-toggle svg {
        width: 18px;
        height: 18px;
        color: var(--text-secondary);
      }
      .sun-icon { display: block; }
      .moon-icon { display: none; }
      html[data-theme="dark"] .sun-icon { display: none; }
      html[data-theme="dark"] .moon-icon { display: block; }
      #redoc-container {
        background: var(--bg);
      }
      @media (max-width: 600px) {
        .header { padding: 0 16px; }
        .version { display: none; }
      }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="header-left">
        <a href="/api/docs" class="logo">
          <span class="logo-text">AgentLabs</span>
          <span class="logo-api">API</span>
        </a>
        <span class="version">v1.0</span>
      </div>
      <div class="header-right">
        <a href="/api/docs/playground" class="playground-btn" title="Interactive API Playground">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
          Try it
        </a>
        <button class="theme-toggle" id="themeToggle" title="Toggle theme">
          <svg class="sun-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"/>
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
          </svg>
          <svg class="moon-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
          </svg>
        </button>
      </div>
    </div>
    <div id="redoc-container"></div>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
    <script>
      (function() {
        var theme = localStorage.getItem('api-docs-theme');
        if (!theme) {
          theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.setAttribute('data-theme', theme);
        
        function getRedocTheme(isDark) {
          return {
            spacing: { sectionVertical: 20, sectionHorizontal: 28 },
            colors: {
              primary: { main: isDark ? '#7c75ff' : '#635bff' },
              success: { main: '#30c85e' },
              warning: { main: '#f5a623' },
              error: { main: '#ed5f74' },
              text: { primary: isDark ? '#f6f9fc' : '#0a2540', secondary: isDark ? '#a3acb9' : '#425466' },
              border: { dark: isDark ? '#2a2a2a' : '#e3e8ee', light: isDark ? '#1a1a1a' : '#f6f9fc' },
              http: { get: '#0073e6', post: '#30c85e', put: '#f5a623', delete: '#ed5f74', patch: '#9a6eff' }
            },
            typography: {
              fontSize: '14px',
              lineHeight: '1.6',
              fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              headings: { fontFamily: 'Inter, sans-serif', fontWeight: '600' },
              code: { fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace', fontSize: '13px', lineHeight: '1.5' }
            },
            sidebar: {
              backgroundColor: isDark ? '#111111' : '#f6f9fc',
              textColor: isDark ? '#a3acb9' : '#425466',
              activeTextColor: isDark ? '#ffffff' : '#0a2540',
              groupItems: { textTransform: 'uppercase' },
              width: '260px'
            },
            rightPanel: {
              backgroundColor: isDark ? '#1a1a1a' : '#0a2540',
              textColor: '#ffffff',
              width: '40%'
            }
          };
        }
        
        function initRedoc() {
          var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
          var container = document.getElementById('redoc-container');
          container.innerHTML = '';
          Redoc.init('/api/docs/openapi.json', {
            hideDownloadButton: true,
            hideHostname: false,
            expandResponses: '200,201',
            requiredPropsFirst: true,
            sortPropsAlphabetically: true,
            pathInMiddlePanel: true,
            scrollYOffset: 64,
            nativeScrollbars: true,
            theme: getRedocTheme(isDark)
          }, container);
        }
        
        document.getElementById('themeToggle').addEventListener('click', function() {
          var current = document.documentElement.getAttribute('data-theme');
          var next = current === 'dark' ? 'light' : 'dark';
          document.documentElement.setAttribute('data-theme', next);
          localStorage.setItem('api-docs-theme', next);
          initRedoc();
        });
        
        initRedoc();
      })();
    </script>
  </body>
</html>`);
    });

    // Serve Swagger UI playground for interactive API testing
    const swaggerUiOptions = {
      customCss: `
        .swagger-ui .topbar { display: none; }
        .swagger-ui .info { margin-bottom: 16px; }
        .swagger-ui .info .title { font-size: 28px; }
        .swagger-ui .info .description { max-height: 120px; overflow: hidden; }
        .swagger-ui .scheme-container { 
          background: #f6f9fc; 
          padding: 12px 16px;
          position: sticky;
          top: 0;
          z-index: 100;
          border-bottom: 1px solid #e3e8ee;
        }
        .swagger-ui .opblock-tag { 
          font-size: 16px; 
          padding: 8px 0;
          border-bottom: 1px solid #e3e8ee;
        }
        .swagger-ui .opblock { margin-bottom: 8px; }
        .swagger-ui .opblock .opblock-summary { padding: 8px 12px; }
        .swagger-ui .opblock-summary-method { 
          min-width: 60px; 
          font-size: 12px;
          padding: 4px 8px;
        }
        .swagger-ui .filter-container { 
          margin: 0 0 16px 0;
          position: sticky;
          top: 52px;
          z-index: 99;
          background: white;
          padding: 8px 0;
        }
        .swagger-ui .filter .operation-filter-input {
          border: 1px solid #e3e8ee;
          border-radius: 6px;
          padding: 8px 12px;
        }
        .swagger-ui section.models { display: none; }
        body { background: #fafbfc; }
        .swagger-ui .wrapper { max-width: 1200px; padding: 16px 24px; }
      `,
      customSiteTitle: 'AgentLabs API Playground',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: 'none',
        filter: true,
        showExtensions: false,
        defaultModelsExpandDepth: -1,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
        tryItOutEnabled: true,
        deepLinking: true,
      },
    };
    
    app.use('/api/docs/playground', swaggerUi.serve);
    app.get('/api/docs/playground', swaggerUi.setup(openApiDocument, swaggerUiOptions));
    
    console.log('[REST API] Redoc documentation available at /api/docs (public access)');
    console.log('[REST API] Swagger UI playground available at /api/docs/playground');
  } catch (error) {
    console.warn('[REST API] Could not load OpenAPI spec, documentation disabled:', error);
  }
  
  console.log(`[REST API] Plugin registered at ${API_BASE_PATH}`);
  console.log('[REST API] Endpoints:');
  console.log(`  - ${API_BASE_PATH}/calls`);
  console.log(`  - ${API_BASE_PATH}/campaigns`);
  console.log(`  - ${API_BASE_PATH}/agents`);
  console.log(`  - ${API_BASE_PATH}/contacts`);
  console.log(`  - ${API_BASE_PATH}/credits`);
  console.log(`  - ${API_BASE_PATH}/analytics`);
  console.log(`  - ${API_BASE_PATH}/webhooks`);
  console.log('  - /api/user/api-keys (session auth)');
  console.log('  - /api/admin/api-keys (admin auth)');
}

/**
 * Plugin metadata for discovery
 */
export const pluginInfo = {
  name: 'rest-api',
  version: '1.0.0',
  description: 'Comprehensive REST API for external system integration',
  author: 'AgentLabs',
  features: [
    'API Key Authentication',
    'Rate Limiting',
    'Request Audit Logging',
    'IP Whitelisting',
    'Scoped Permissions',
    'Calls API',
    'Campaigns API',
    'Agents API',
    'Contacts API',
    'Credits API',
    'Analytics API',
    'Webhooks API',
    'Flow Export/Import',
  ],
};
