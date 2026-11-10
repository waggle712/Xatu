import { CatalogModule } from './catalog/catalog.module.js';
import { ContentModule } from './content/content.module.js';
import { FulfilmentModule } from './fulfilment/fulfilment.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { MediaModule } from './media/media.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';
import { SearchModule } from './search/search.module.js';
import { TrustModule } from './trust/trust.module.js';

export const domainModules = [
  IdentityModule,
  MediaModule,
  ProfilesModule,
  ContentModule,
  CatalogModule,
  OrdersModule,
  PaymentsModule,
  FulfilmentModule,
  TrustModule,
  MessagingModule,
  NotificationsModule,
  SearchModule,
];
