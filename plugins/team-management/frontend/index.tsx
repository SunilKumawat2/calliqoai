/**
 * Team Management Plugin Frontend Entry
 * Self-registers UI components via the global plugin registry
 */

import UserTeamManagement from '../ui/UserTeamManagement';
import AdminTeamManagement from '../ui/AdminTeamManagement';

(function registerTeamManagementPlugin() {
  const registry = (window as any).__AGENTLABS_PLUGIN_REGISTRY__;
  
  if (!registry) {
    console.error('[TeamManagement Plugin] Plugin registry not found');
    return;
  }

  registry.registerSettingsTab({
    id: 'team',
    pluginName: 'team-management',
    label: 'Team',
    icon: 'Users',
    component: UserTeamManagement,
    order: 50,
  });

  registry.registerAdminMenuItem({
    id: 'team-management',
    pluginName: 'team-management',
    label: 'Team Management',
    icon: 'Users',
    path: '/admin/team-management',
    component: AdminTeamManagement,
    order: 80,
  });

  registry.markPluginLoaded('team-management');
  
  console.log('[TeamManagement Plugin] Registered UI components');
})();
