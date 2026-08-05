import UserMessagingPage from '../ui/UserMessagingPage';
import AdminMessagingPage from '../ui/AdminMessagingPage';
import WhatsAppConversationsPage from '../ui/WhatsAppConversationsPage';

(function registerMessagingPlugin() {
  const registry = (window as any).__AGENTLABS_PLUGIN_REGISTRY__;
  
  if (!registry) {
    console.error('[Messaging Plugin] Plugin registry not found');
    return;
  }

  registry.registerSettingsTab({
    id: 'messaging',
    pluginName: 'messaging',
    label: 'Messaging',
    icon: 'Mail',
    component: UserMessagingPage,
    order: 80,
  });

  registry.registerAdminSettingsTab({
    id: 'messaging',
    pluginName: 'messaging',
    label: 'Messaging',
    icon: 'Mail',
    component: AdminMessagingPage,
    order: 80,
  });

  registry.registerRoute({
    id: 'messaging-conversations',
    pluginName: 'messaging',
    path: '/app/conversations',
    component: WhatsAppConversationsPage,
    label: 'Conversations',
    icon: 'MessageSquare',
  });

  registry.markPluginLoaded('messaging');
  
  console.log('[Messaging Plugin] Registered UI components');
})();
