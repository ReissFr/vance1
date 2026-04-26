// @jarvis/integrations — pluggable third-party provider framework.
//
// Agents depend on capability interfaces (EmailProvider, PaymentProvider, ...),
// not on concrete SDKs. A resolver looks up the user's active integration row
// and returns the right implementation.
//
// To add a new provider for an existing kind:
//   1. Implement the interface under `src/<kind>/<provider>.ts`.
//   2. Register it in the switch in `src/resolver.ts`.
//   3. The rest of the app doesn't change.
//
// To add a new kind (e.g. payment):
//   1. Define the interface under `src/<kind>/provider.ts`.
//   2. Add a `get<Kind>Provider()` function in `src/resolver.ts`.
//   3. Add the string to the `integrations.kind` check in the migration.

export type { EmailProvider, EmailSummary, EmailListQuery, DraftResult } from "./email/provider";
export type {
  PaymentProvider,
  RevenueRange,
  RevenueSummary,
  Customer,
  Charge,
  ChargeStatus,
  Subscription,
  SubscriptionStatus,
} from "./payment/provider";
export type {
  SmartHomeProvider,
  HomeDevice,
  HomeDeviceType,
  HomeCommand,
  CommandResult,
} from "./home/provider";
export type {
  BankingProvider,
  Account,
  AccountType,
  Transaction,
  TxnRange,
  SpendingSummary,
  SpendingBucket,
} from "./banking/provider";
export type {
  CryptoProvider,
  CryptoWallet,
  CryptoTransaction,
  CryptoTxType,
  CryptoTxStatus,
  CryptoTxnRange,
  CryptoPortfolio,
  CryptoPortfolioSlice,
  CryptoSendRequest,
  CryptoSendResult,
} from "./crypto/provider";
export type {
  CommerceProvider,
  Order,
  OrderStatus,
  Product,
  InventoryLevel,
  SalesRange,
  SalesSummary,
} from "./commerce/provider";
export type {
  AccountingProvider,
  Invoice,
  InvoiceStatus,
  Expense,
  Balance,
  Contact,
  AccountingRange,
} from "./accounting/provider";
export type {
  ProductivityProvider,
  ProductivitySearchResult,
  ProductivityPage,
  ProductivityDatabase,
  CreatePageInput,
  AddDatabaseRowInput,
} from "./productivity/provider";
export type {
  DevProvider,
  Repo,
  Issue,
  IssueState,
  PullRequest,
  DevNotification,
  CodeHit,
  CommentResult,
  ListIssuesInput,
  ListPullRequestsInput,
  CreateIssueInput,
  CommentInput,
  SearchCodeInput,
} from "./dev/provider";
export type {
  MessagingProvider,
  Channel,
  MessagingUser,
  Message,
  SendResult,
  ListChannelsInput,
  SendMessageInput,
  SendDmInput,
  ReadChannelInput,
  SearchMessagesInput,
} from "./messaging/provider";
export type {
  CalendarProvider,
  EventType,
  Booking,
  Attendee,
  ListBookingsInput,
} from "./calendar/provider";
export type {
  TasksProvider,
  TaskIssue,
  TaskProject,
  TaskState,
  ListTasksInput,
  CreateTaskInput,
  UpdateTaskInput,
} from "./tasks/provider";
export type {
  TransactionalProvider,
  SendEmailInput,
  SendEmailResult,
} from "./transactional/provider";
export type {
  FilesProvider,
  FileEntry,
  FileSearchInput,
  FileContent,
  UploadFileInput,
} from "./files/provider";
export {
  getEmailProvider,
  getPaymentProvider,
  getSmartHomeProvider,
  getBankingProvider,
  getCryptoProvider,
  getCommerceProvider,
  getAccountingProvider,
  getProductivityProvider,
  getDevProvider,
  getMessagingProvider,
  getCalendarProvider,
  getTasksProvider,
  getTransactionalProvider,
  getFilesProvider,
  listActiveIntegrations,
} from "./resolver";
export type { IntegrationKind, IntegrationRow } from "./types";
