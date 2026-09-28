# plan.md: angular-ngzorro-crm-workspace

## 0. Bootstrap, Dependencies & System Standards

### 0.1 Dependency Manifest & Scaffolding Strategy
*   Scaffold workspace with zone change detection, SCSS styling, and no SSR:
    `ng new angular-ngzorro-crm-workspace --routing --style=scss --ssr=false --zoneless=false` (Verify CLI flags with `ng new --help`).
*   Install UI library non-interactively:
    `ng add ng-zorro-antd --skip-confirmation --theme=false` (Verify schematic flags with `ng add ng-zorro-antd --help`).
*   Install linter non-interactively:
    `ng add angular-eslint --skip-confirmation` (fallback: `ng add @angular-eslint/schematics --skip-confirmation`).
*   Post-scaffold file cleanup:
    *   If scaffold emits `src/app/app.ts` with class `App`, rename it to `src/app/app.component.ts` with class `AppComponent`, and update references in `src/main.ts`. Rename `src/app/app.spec.ts` to `src/app/app.component.spec.ts` (or delete if tests are omitted).
    *   During Phases 1 through 4, keep a simple placeholder template in `AppComponent` (`<h1>CRM Workspace Initializing...</h1>`) to prevent NG8001 compiler errors. Mount `<app-workspace-shell />` only in Phase 5.7.
    *   Remove `src/app/app.routes.ts` if generated and unused, as application tabs are managed in-memory via `WorkspaceTabService`.
    *   Remove auto-generated `src/app/icons-provider.ts` to prevent provider collision.
    *   Verify `node_modules/ng-zorro-antd/ng-zorro-antd.min.css` is present in `angular.json` styles or imported in `src/styles.scss`.
*   Direct dependencies:
    `@angular/core`, `@angular/common`, `@angular/forms`, `@angular/router`, `@angular/animations`, `@angular/cdk`, `@angular/platform-browser`, `ng-zorro-antd`, `@ant-design/icons-angular`.
*   HTML viewport standard:
    `src/index.html` must declare `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.
*   TypeScript path aliases in `tsconfig.json`:
    *   `@core/*` -> `src/app/core/*`
    *   `@shared/*` -> `src/app/shared/*`
    *   `@features/*` -> `src/app/features/*`
*   No barrel files (`index.ts`) permitted to eliminate cyclic dependency graphs.
*   Linter rule configuration: In `.eslintrc.json`, configure `@typescript-eslint/no-explicit-any` as `warn` or use `unknown` with explicit type guards across all domain utilities.

### 0.1.1 Engineering Standards & Definition of Done
*   **Definition of Done per phase:** `ng build` and `ng lint` must execute without errors before starting subsequent phases.
*   On build or lint failure, fix the code immediately within the active phase boundaries.
*   If an internal specification conflict is detected, stop immediately and resolve the architectural definition before writing further code.

### 0.2 Application Bootstrap & Providers
`src/app/app.config.ts` must configure change detection, routing, asynchronous animations, icons, and NG-ZORRO global theme settings:
```typescript
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideNzI18n, en_US } from 'ng-zorro-antd/i18n';
import { provideNzIcons } from 'ng-zorro-antd/icon';
import { provideNzConfig } from 'ng-zorro-antd/core/config';
import { IconDefinition } from '@ant-design/icons-angular';
import {
  DashboardOutline,
  TeamOutline,
  DollarOutline,
  CalendarOutline,
  FileTextOutline,
  PlusOutline,
  SearchOutline,
  CloseOutline,
  FilterOutline,
  CheckCircleOutline,
  ClockCircleOutline,
  RightOutline,
  MenuOutline,
  EditOutline,
  DeleteOutline,
  DownOutline
} from '@ant-design/icons-angular/icons';

export const APP_ICONS: IconDefinition[] = [
  DashboardOutline, TeamOutline, DollarOutline, CalendarOutline,
  FileTextOutline, PlusOutline, SearchOutline, CloseOutline,
  FilterOutline, CheckCircleOutline, ClockCircleOutline, RightOutline,
  MenuOutline, EditOutline, DeleteOutline, DownOutline
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter([], withComponentInputBinding()),
    provideAnimationsAsync(),
    provideNzI18n(en_US),
    provideNzIcons(APP_ICONS),
    provideNzConfig({
      theme: {
        primaryColor: '#0176d3'
      }
    })
  ]
};
```

---

## 1. Data Schema & Pure TypeScript Interfaces

### 1.1 Domain Models and Enums
`src/app/core/models/crm.models.ts`:

```typescript
export type UUID = string;
export type ISO8601Date = string;
export type ISODateOnly = string; // Format: YYYY-MM-DD

export enum OpportunityStage {
  PROSPECTING = 'PROSPECTING',
  QUALIFICATION = 'QUALIFICATION',
  NEEDS_ANALYSIS = 'NEEDS_ANALYSIS',
  VALUE_PROPOSITION = 'VALUE_PROPOSITION',
  DECISION_MAKERS = 'DECISION_MAKERS',
  NEGOTIATION = 'NEGOTIATION',
  CLOSED_WON = 'CLOSED_WON',
  CLOSED_LOST = 'CLOSED_LOST'
}

export enum ForecastCategory {
  PIPELINE = 'PIPELINE',
  BEST_CASE = 'BEST_CASE',
  COMMIT = 'COMMIT',
  CLOSED = 'CLOSED',
  OMITTED = 'OMITTED'
}

export enum ActivityType {
  TASK = 'TASK',
  CALL = 'CALL',
  MEETING = 'MEETING',
  EMAIL = 'EMAIL',
  NOTE = 'NOTE'
}

export enum PriorityLevel {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export enum ActivityStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  DEFERRED = 'DEFERRED'
}

export enum IndustryType {
  FINANCIAL_SERVICES = 'FINANCIAL_SERVICES',
  HEALTHCARE = 'HEALTHCARE',
  TECHNOLOGY = 'TECHNOLOGY',
  MANUFACTURING = 'MANUFACTURING',
  RETAIL = 'RETAIL',
  ENERGY = 'ENERGY',
  CONSULTING = 'CONSULTING'
}

export const ICON_NAMES = [
  'dashboard',
  'team',
  'dollar',
  'calendar',
  'file-text',
  'plus',
  'search',
  'close',
  'filter',
  'menu',
  'edit',
  'delete',
  'down'
] as const;

export type SupportedIcon = typeof ICON_NAMES[number];

export class ConflictError extends Error {
  constructor(message: string = 'Version conflict encountered while updating record.') {
    super(message);
    this.name = 'ConflictError';
  }
}

export class StageTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StageTransitionError';
  }
}

export interface Address {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface Account {
  id: UUID;
  name: string;
  accountNumber: string;
  industry: IndustryType;
  annualRevenue: number;
  phone: string;
  website: string;
  billingAddress: Address;
  shippingAddress: Address;
  ownerId: UUID;
  ownerName: string;
  rating: 'HOT' | 'WARM' | 'COLD';
  version: number;
  createdAt: ISO8601Date;
  updatedAt: ISO8601Date;
}

export interface Contact {
  id: UUID;
  accountId: UUID;
  firstName: string;
  lastName: string;
  title: string;
  department: string;
  email: string;
  phone: string;
  mobilePhone: string;
  isPrimary: boolean;
  leadSource: string;
  version: number;
  createdAt: ISO8601Date;
  updatedAt: ISO8601Date;
}

export interface Opportunity {
  id: UUID;
  accountId: UUID;
  primaryContactId: UUID;
  name: string;
  stage: OpportunityStage;
  amount: number;
  closeDate: ISODateOnly;
  nextStep: string;
  leadSource: string;
  lossReason?: string;
  ownerId: UUID;
  ownerName: string;
  version: number;
  createdAt: ISO8601Date;
  updatedAt: ISO8601Date;
}

export interface OpportunityView extends Opportunity {
  probability: number;
  expectedRevenue: number;
  forecastCategory: ForecastCategory;
}

export interface Activity {
  id: UUID;
  entityType: 'ACCOUNT' | 'OPPORTUNITY' | 'CONTACT';
  entityId: UUID;
  type: ActivityType;
  subject: string;
  status: ActivityStatus;
  priority: PriorityLevel;
  dueDate: ISO8601Date | null;
  completedDate: ISO8601Date | null;
  assignedToId: UUID;
  assignedToName: string;
  notes: string;
  version: number;
  createdAt: ISO8601Date;
  updatedAt: ISO8601Date;
}

export interface WorkspaceTab {
  id: string;
  title: string;
  entityType: 'ACCOUNT' | 'OPPORTUNITY' | 'LIST' | 'DASHBOARD';
  entityId: UUID | null;
  listKey?: 'accounts' | 'opportunities';
  icon: SupportedIcon;
  isDirty: boolean;
  closable: boolean;
  activeSubTabKey: string;
}

export interface FilterCriterion {
  field: string;
  operator: 'equals' | 'contains' | 'greaterThan' | 'lessThan' | 'in' | 'isEmpty' | 'isNotEmpty';
  value?: string | number | boolean | string[] | null;
}

export interface SortCriterion {
  field: string;
  direction: 'asc' | 'desc';
}

export interface EntityQueryOptions {
  pageIndex: number;
  pageSize: number;
  sort: SortCriterion[];
  filters: FilterCriterion[];
}

export interface PaginatedResult<T> {
  items: T[];
  totalCount: number;
  pageIndex: number;
  pageSize: number;
}
```

### 1.2 Form State & Input Models
`src/app/core/models/crm.models.ts` (continued):

```typescript
export interface AccountFormModel {
  name: string;
  accountNumber: string;
  industry: IndustryType;
  annualRevenue: number;
  phone: string;
  website: string;
  rating: 'HOT' | 'WARM' | 'COLD';
  billingStreet: string;
  billingCity: string;
  billingState: string;
  billingPostalCode: string;
  billingCountry: string;
}

export interface ContactFormModel {
  accountId: UUID;
  firstName: string;
  lastName: string;
  title: string;
  department: string;
  email: string;
  phone: string;
  mobilePhone: string;
  isPrimary: boolean;
  leadSource: string;
}

export interface OpportunityFormModel {
  name: string;
  accountId: UUID;
  primaryContactId: UUID;
  stage: OpportunityStage;
  amount: number;
  closeDate: string;
  nextStep: string;
  leadSource: string;
  lossReason?: string;
}

export interface ActivityFormModel {
  entityType: 'ACCOUNT' | 'OPPORTUNITY' | 'CONTACT';
  entityId: UUID;
  type: ActivityType;
  subject: string;
  status: ActivityStatus;
  priority: PriorityLevel;
  dueDate: string | null;
  assignedToName: string;
  notes: string;
}
```

### 1.3 Storage Injection Tokens & Keys
`src/app/core/tokens/crm-storage.token.ts`:

```typescript
import { InjectionToken } from '@angular/core';

export const CRM_STORAGE_KEYS = {
  SCHEMA_VERSION: 'ng_crm_schema_version',
  ACCOUNTS: 'ng_crm_accounts_v1',
  CONTACTS: 'ng_crm_contacts_v1',
  OPPORTUNITIES: 'ng_crm_opportunities_v1',
  ACTIVITIES: 'ng_crm_activities_v1'
} as const;

export const WORKSPACE_SESSION_KEYS = {
  WORKSPACE_TABS: 'ng_crm_session_tabs_v1',
  ACTIVE_TAB_ID: 'ng_crm_session_active_tab_v1'
} as const;

export const LOCAL_STORAGE = new InjectionToken<Storage | null>('LOCAL_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
      return null;
    }
  }
});

export const SESSION_STORAGE = new InjectionToken<Storage | null>('SESSION_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return typeof window !== 'undefined' ? window.sessionStorage : null;
    } catch {
      return null;
    }
  }
});
```

---

## 2. Component Architecture

```
src/app/
+-- core/
|   +-- models/
|   |   +-- crm.models.ts
|   +-- tokens/
|   |   +-- crm-storage.token.ts
|   +-- utils/
|   |   +-- uuid.ts
|   |   +-- pipeline-calc.ts
|   |   +-- filter-evaluator.ts
|   +-- fixtures/
|   |   +-- mock-crm-data.ts
|   +-- services/
|       +-- viewport.service.ts
|       +-- keyboard-shortcut.service.ts
|       +-- crm-storage.service.ts
|       +-- crm-repository.service.ts
|       +-- workspace-tab.service.ts
+-- shared/
|   +-- ui/
|   |   +-- compact-badge/
|   |   |   +-- compact-badge.component.ts
|   |   +-- metric-chip/
|   |   |   +-- metric-chip.component.ts
|   |   +-- stage-path/
|   |   |   +-- stage-path.component.ts
|   |   |   +-- stage-path.component.scss
|   |   +-- record-banner/
|   |   |   +-- record-banner.component.ts
|   |   |   +-- record-banner.component.scss
|   |   +-- related-entity-card/
|   |   |   +-- related-entity-card.component.ts
|   |   |   +-- related-entity-card.component.scss
|   |   +-- quick-create-drawer/
|   |   |   +-- quick-create-drawer.component.ts
|   |   |   +-- quick-create-drawer.component.scss
|   |   +-- dense-table-toolbar/
|   |   |   +-- dense-table-toolbar.component.ts
|   |   +-- activity-timeline/
|   |       +-- activity-timeline.component.ts
|   |       +-- activity-timeline.component.scss
|   +-- pipes/
|       +-- currency-formatter.pipe.ts
|       +-- stage-color.pipe.ts
+-- features/
|   +-- workspace/
|   |   +-- workspace-shell.component.ts
|   |   +-- workspace-shell.component.scss
|   |   +-- pipeline-dashboard/
|   |   |   +-- pipeline-dashboard.component.ts
|   |   |   +-- pipeline-dashboard.component.scss
|   |   +-- components/
|   |       +-- console-tab-bar/
|   |       |   +-- console-tab-bar.component.ts
|   |       |   +-- console-tab-bar.component.scss
|   |       +-- utility-bar/
|   |           +-- utility-bar.component.ts
|   +-- accounts/
|   |   +-- account-list/
|   |   |   +-- account-list.component.ts
|   |   +-- account-detail/
|   |       +-- account-detail.component.ts
|   |       +-- account-detail.component.scss
|   +-- opportunities/
|   |   +-- components/
|   |   |   +-- loss-reason-modal/
|   |   |       +-- loss-reason-modal.component.ts
|   |   +-- opportunity-list/
|   |   |   +-- opportunity-list.component.ts
|   |   +-- opportunity-detail/
|   |       +-- opportunity-detail.component.ts
|   |       +-- opportunity-detail.component.scss
|   +-- activities/
|       +-- activity-composer/
|           +-- activity-composer.component.ts
+-- styles/
    +-- _density-overrides.scss
    +-- _theme-variables.scss
```

### 2.0 Symbol-to-File Matrix
| Symbol / Artifact | Canonical File Path | Exports |
| :--- | :--- | :--- |
| Enums, Interfaces, Tab Models | `src/app/core/models/crm.models.ts` | `UUID`, `ISO8601Date`, `ISODateOnly`, `OpportunityStage`, `ForecastCategory`, `ActivityType`, `PriorityLevel`, `ActivityStatus`, `IndustryType`, `Address`, `Account`, `Contact`, `Opportunity`, `OpportunityView`, `Activity`, `WorkspaceTab`, `ICON_NAMES`, `SupportedIcon`, `ConflictError`, `StageTransitionError`, `FilterCriterion`, `SortCriterion`, `EntityQueryOptions`, `PaginatedResult`, `AccountFormModel`, `ContactFormModel`, `OpportunityFormModel`, `ActivityFormModel` |
| Storage Injection Tokens & Keys | `src/app/core/tokens/crm-storage.token.ts` | `CRM_STORAGE_KEYS`, `WORKSPACE_SESSION_KEYS`, `LOCAL_STORAGE`, `SESSION_STORAGE` |
| Resilient ID Generator | `src/app/core/utils/uuid.ts` | `generateId` |
| Responsive Viewport Service | `src/app/core/services/viewport.service.ts` | `ViewportService` |
| Global Keyboard Shortcuts | `src/app/core/services/keyboard-shortcut.service.ts` | `KeyboardShortcutService` |
| Storage Engine with Fallback | `src/app/core/services/crm-storage.service.ts` | `CrmStorageService` |
| Financial & Stage Functions | `src/app/core/utils/pipeline-calc.ts` | `STAGE_CONFIG`, `calculateExpectedRevenue`, `deriveForecastCategory`, `validateStageTransition`, `applyStageTransition`, `toLocalDateOnly`, `calculateWinRate`, `calculateWeightedForecast` |
| Filter & Sorter Engine | `src/app/core/utils/filter-evaluator.ts` | `evaluateCriteria` |
| Seed Dataset | `src/app/core/fixtures/mock-crm-data.ts` | `SEED_ACCOUNTS`, `SEED_CONTACTS`, `SEED_OPPORTUNITIES`, `SEED_ACTIVITIES` |
| Tab State Manager | `src/app/core/services/workspace-tab.service.ts` | `WorkspaceTabService` |
| Reactive CRM Entity Store | `src/app/core/services/crm-repository.service.ts` | `CrmRepositoryService` |
| Currency Formatter Pipe | `src/app/shared/pipes/currency-formatter.pipe.ts` | `CurrencyFormatterPipe` |
| Stage Color Pipe | `src/app/shared/pipes/stage-color.pipe.ts` | `StageColorPipe` |
| Root Application Component | `src/app/app.component.ts` | `AppComponent` |
| Workspace Shell Component | `src/app/features/workspace/workspace-shell.component.ts` | `WorkspaceShellComponent` |
| Pipeline Dashboard Component | `src/app/features/workspace/pipeline-dashboard/pipeline-dashboard.component.ts` | `PipelineDashboardComponent` |
| Quick Create Drawer | `src/app/shared/ui/quick-create-drawer/quick-create-drawer.component.ts` | `QuickCreateDrawerComponent` |
| Loss Reason Modal | `src/app/features/opportunities/components/loss-reason-modal/loss-reason-modal.component.ts` | `LossReasonModalComponent` |

### 2.4 Component API Contracts

#### 2.4.1 Shared UI Primitives & Molecules
| Component Class | Selector | Input Signals (`input()`) | Output Signals (`output()`) |
| :--- | :--- | :--- | :--- |
| `StagePathComponent` | `app-stage-path` | `currentStage: OpportunityStage`, `readOnly: boolean` | `stageChange: OutputEmitterRef<OpportunityStage>` |
| `RecordBannerComponent` | `app-record-banner` | `title: string`, `icon: SupportedIcon`, `metrics: { label: string; value: string }[]` | `editClick: OutputEmitterRef<void>`, `deleteClick: OutputEmitterRef<void>` |
| `MetricChipComponent` | `app-metric-chip` | `label: string`, `value: string \| number` | None |
| `CompactBadgeComponent` | `app-compact-badge` | `status: string`, `colorType: 'success' \| 'warning' \| 'error' \| 'default'` | None |
| `ActivityTimelineComponent` | `app-activity-timeline` | `activities: Activity[]` | `statusToggle: OutputEmitterRef<{ id: UUID; completed: boolean }>` |
| `RelatedEntityCardComponent` | `app-related-entity-card` | `title: string`, `count: number`, `columns: { key: string; label: string }[]`, `data: unknown[]` | `addClick: OutputEmitterRef<void>`, `rowClick: OutputEmitterRef<UUID>` |
| `QuickCreateDrawerComponent` | `app-quick-create-drawer` | `visible: boolean`, `mode: 'create' \| 'edit'`, `entityType: 'ACCOUNT' \| 'CONTACT' \| 'OPPORTUNITY' \| 'ACTIVITY'`, `recordId: UUID \| null`, `contextId: UUID \| null`, `contextType: 'ACCOUNT' \| 'OPPORTUNITY' \| 'CONTACT' \| null` | `closed: OutputEmitterRef<void>`, `created: OutputEmitterRef<void>` |
| `ConsoleTabBarComponent` | `app-console-tab-bar` | `tabs: WorkspaceTab[]`, `activeTabId: string` | `tabSelect: OutputEmitterRef<string>`, `tabClose: OutputEmitterRef<string>` |
| `UtilityBarComponent` | `app-utility-bar` | `activeTabId: string`, `entityCount: number` | `quickActionClick: OutputEmitterRef<'NEW_ACCOUNT' \| 'NEW_TASK' \| 'SEARCH'>` |
| `LossReasonModalComponent` | `app-loss-reason-modal` | `visible: boolean` | `confirmed: OutputEmitterRef<string>`, `cancelled: OutputEmitterRef<void>` |
| `DenseTableToolbarComponent` | `app-dense-table-toolbar` | `searchPlaceholder: string`, `filterActive: boolean` | `searchChange: OutputEmitterRef<string>`, `filterToggle: OutputEmitterRef<void>`, `newClick: OutputEmitterRef<void>`, `densityChange: OutputEmitterRef<'compact' \| 'normal'>`, `columnsChange: OutputEmitterRef<string[]>` |
| `ActivityComposerComponent` | `app-activity-composer` | `entityType: 'ACCOUNT' \| 'OPPORTUNITY' \| 'CONTACT'`, `entityId: UUID` | `activityAdded: OutputEmitterRef<void>` |

#### 2.4.2 Feature View Contracts & Shell Dynamic Registry
*   **Tab Identification Convention:** Built via `WorkspaceTabService.tabIdFor(entityType, entityIdOrListKey)`. Generated string: `${entityType}:${entityIdOrListKey}`. Contacts do not hold independent tabs; clicking a contact resolves parent account tab `ACCOUNT:${contact.accountId}` with `activeSubTabKey: 'contacts'`.
*   **Feature View Inputs:**
    *   `AccountDetailComponent`: `entityId: InputSignal<UUID>`
    *   `OpportunityDetailComponent`: `entityId: InputSignal<UUID>`
    *   `AccountListComponent`: None
    *   `OpportunityListComponent`: None
    *   `PipelineDashboardComponent`: None
*   **Keep-Alive Dynamic Shell Rendering:** To prevent NG0100 change detection expressions and preserve form states during tab switching, `WorkspaceShellComponent` renders all open tabs simultaneously, toggling visibility via `[hidden]`:
    ```html
    @for (tab of tabs(); track tab.id) {
      <div class="workspace-pane" [hidden]="tab.id !== activeTabId()">
        <ng-container
          *ngComponentOutlet="
            resolveComponent(tab);
            inputs: resolveInputs(tab)
          "
        />
      </div>
    }
    ```
    ```typescript
    protected resolveComponent(tab: WorkspaceTab): Type<unknown> {
      switch (tab.entityType) {
        case 'ACCOUNT': return AccountDetailComponent;
        case 'OPPORTUNITY': return OpportunityDetailComponent;
        case 'LIST': return tab.listKey === 'opportunities' ? OpportunityListComponent : AccountListComponent;
        case 'DASHBOARD': return PipelineDashboardComponent;
      }
    }

    protected resolveInputs(tab: WorkspaceTab): Record<string, unknown> {
      if (tab.entityType === 'ACCOUNT' || tab.entityType === 'OPPORTUNITY') {
        return { entityId: tab.entityId };
      }
      return {};
    }
    ```
*   **Form Dirty State & Shortcut Isolation:**
    *   Detail components monitor their local reactive `FormGroup.dirty` state and call `this.tabService.setTabDirty(this.myTabId, isDirty)`.
    *   `KeyboardShortcutService.saveRequested$` is evaluated by detail components only if `this.tabService.activeTabId() === this.myTabId`.
    *   `WorkspaceShellComponent` handles `KeyboardShortcutService.tabCloseRequested$` by directly closing `activeTabId()`.
*   **Delete Handling Contract:** Detail components intercept `RecordBannerComponent.deleteClick`, show confirmation through `NzModalService.confirm`, invoke the repository deletion cascade, and execute `WorkspaceTabService.closeTab(myTabId)`.

---

## 3. Core Feature Logic

### 3.1 Pipeline Calculations & Date Handling
`src/app/core/utils/pipeline-calc.ts`:

```typescript
import { OpportunityStage, ForecastCategory, Opportunity, ISODateOnly } from '@core/models/crm.models';

export interface StageMetadata {
  probability: number;
  label: string;
  order: number;
  closed: boolean;
  forecastCategory: ForecastCategory;
}

export const STAGE_CONFIG: Record<OpportunityStage, StageMetadata> = {
  [OpportunityStage.PROSPECTING]: { probability: 10, label: 'Prospecting', order: 1, closed: false, forecastCategory: ForecastCategory.PIPELINE },
  [OpportunityStage.QUALIFICATION]: { probability: 20, label: 'Qualification', order: 2, closed: false, forecastCategory: ForecastCategory.PIPELINE },
  [OpportunityStage.NEEDS_ANALYSIS]: { probability: 40, label: 'Needs Analysis', order: 3, closed: false, forecastCategory: ForecastCategory.PIPELINE },
  [OpportunityStage.VALUE_PROPOSITION]: { probability: 60, label: 'Value Proposition', order: 4, closed: false, forecastCategory: ForecastCategory.BEST_CASE },
  [OpportunityStage.DECISION_MAKERS]: { probability: 75, label: 'Decision Makers', order: 5, closed: false, forecastCategory: ForecastCategory.BEST_CASE },
  [OpportunityStage.NEGOTIATION]: { probability: 90, label: 'Negotiation/Review', order: 6, closed: false, forecastCategory: ForecastCategory.COMMIT },
  [OpportunityStage.CLOSED_WON]: { probability: 100, label: 'Closed Won', order: 7, closed: true, forecastCategory: ForecastCategory.CLOSED },
  [OpportunityStage.CLOSED_LOST]: { probability: 0, label: 'Closed Lost', order: 8, closed: true, forecastCategory: ForecastCategory.OMITTED }
};

export function toLocalDateOnly(d: Date = new Date()): ISODateOnly {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function deriveForecastCategory(stage: OpportunityStage): ForecastCategory {
  return STAGE_CONFIG[stage].forecastCategory;
}

export function calculateExpectedRevenue(amount: number, stage: OpportunityStage): number {
  const prob = STAGE_CONFIG[stage].probability;
  return Math.round((amount * prob) / 100);
}

export function validateStageTransition(
  currentStage: OpportunityStage,
  targetStage: OpportunityStage,
  lossReason?: string
): { valid: boolean; reason?: string } {
  if (currentStage === targetStage) return { valid: true };
  if (targetStage === OpportunityStage.CLOSED_LOST && (!lossReason || lossReason.trim().length === 0)) {
    return { valid: false, reason: 'Loss reason is mandatory when marking Closed Lost.' };
  }
  return { valid: true };
}

export function applyStageTransition(
  opportunity: Opportunity,
  targetStage: OpportunityStage,
  todayDate: ISODateOnly,
  lossReason?: string
): Partial<Opportunity> {
  const patch: Partial<Opportunity> = {
    stage: targetStage
  };

  if (targetStage === OpportunityStage.CLOSED_LOST) {
    patch.lossReason = lossReason?.trim();
  } else {
    patch.lossReason = undefined;
  }

  const isTargetTerminal = targetStage === OpportunityStage.CLOSED_WON || targetStage === OpportunityStage.CLOSED_LOST;
  const isCurrentTerminal = opportunity.stage === OpportunityStage.CLOSED_WON || opportunity.stage === OpportunityStage.CLOSED_LOST;

  if (isTargetTerminal && (!opportunity.closeDate || opportunity.closeDate > todayDate)) {
    patch.closeDate = todayDate;
  } else if (isCurrentTerminal && !isTargetTerminal && opportunity.closeDate < todayDate) {
    patch.closeDate = todayDate;
  }

  return patch;
}

export function calculateWinRate(opportunities: Opportunity[]): number {
  const wonCount = opportunities.filter(o => o.stage === OpportunityStage.CLOSED_WON).length;
  const lostCount = opportunities.filter(o => o.stage === OpportunityStage.CLOSED_LOST).length;
  const totalClosed = wonCount + lostCount;
  return totalClosed === 0 ? 0 : Math.round((wonCount / totalClosed) * 100);
}

export function calculateWeightedForecast(opportunities: Opportunity[]): number {
  return opportunities
    .filter(o => o.stage !== OpportunityStage.CLOSED_WON && o.stage !== OpportunityStage.CLOSED_LOST)
    .reduce((sum, o) => sum + calculateExpectedRevenue(o.amount, o.stage), 0);
}
```

### 3.2 Resilient UUID Generator
`src/app/core/utils/uuid.ts`:

```typescript
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
      (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16)
    );
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
```

### 3.3 Workspace Multi-Tab Service
`src/app/core/services/workspace-tab.service.ts`:

```typescript
import { Injectable, signal, computed, inject } from '@angular/core';
import { NzModalService } from 'ng-zorro-antd/modal';
import { WorkspaceTab, UUID, ICON_NAMES } from '@core/models/crm.models';
import { WORKSPACE_SESSION_KEYS, SESSION_STORAGE } from '@core/tokens/crm-storage.token';

@Injectable({ providedIn: 'root' })
export class WorkspaceTabService {
  private readonly store = inject(SESSION_STORAGE);
  private readonly modalService = inject(NzModalService);
  private isModalOpen = false;

  public static tabIdFor(entityType: WorkspaceTab['entityType'], key: string): string {
    return `${entityType}:${key}`;
  }

  private readonly defaultTab: WorkspaceTab = {
    id: WorkspaceTabService.tabIdFor('DASHBOARD', 'overview'),
    title: 'Executive Pipeline',
    entityType: 'DASHBOARD',
    entityId: null,
    icon: 'dashboard',
    isDirty: false,
    closable: false,
    activeSubTabKey: 'overview'
  };

  private tabsSignal = signal<WorkspaceTab[]>([this.defaultTab]);
  private activeTabIdSignal = signal<string>(WorkspaceTabService.tabIdFor('DASHBOARD', 'overview'));

  public readonly tabs = this.tabsSignal.asReadonly();
  public readonly activeTabId = this.activeTabIdSignal.asReadonly();
  public readonly activeTab = computed(() => {
    return this.tabsSignal().find(t => t.id === this.activeTabIdSignal()) || this.tabsSignal()[0];
  });

  constructor() {
    this.hydrateSession();
  }

  public openTab(tab: Omit<WorkspaceTab, 'isDirty'>): void {
    const existing = this.tabsSignal().find(t => t.id === tab.id);
    if (existing) {
      if (tab.activeSubTabKey && existing.activeSubTabKey !== tab.activeSubTabKey) {
        this.updateSubTab(existing.id, tab.activeSubTabKey);
      }
      this.activeTabIdSignal.set(existing.id);
    } else {
      const newTab: WorkspaceTab = { ...tab, isDirty: false };
      this.tabsSignal.update(tabs => [...tabs, newTab]);
      this.activeTabIdSignal.set(newTab.id);
    }
    this.persist();
  }

  public async closeTab(tabId: string): Promise<boolean> {
    const target = this.tabsSignal().find(t => t.id === tabId);
    if (!target || !target.closable) return false;

    if (target.isDirty) {
      if (this.isModalOpen) return false;
      const confirmed = await this.confirmDiscardModal();
      if (!confirmed) return false;
    }

    const currentTabs = this.tabsSignal();
    const targetIndex = currentTabs.findIndex(t => t.id === tabId);
    const updatedTabs = currentTabs.filter(t => t.id !== tabId);

    this.tabsSignal.set(updatedTabs);
    if (this.activeTabIdSignal() === tabId) {
      const nextIndex = Math.max(0, targetIndex - 1);
      this.activeTabIdSignal.set(updatedTabs[nextIndex].id);
    }

    this.persist();
    return true;
  }

  public setTabDirty(tabId: string, isDirty: boolean): void {
    this.tabsSignal.update(tabs =>
      tabs.map(t => (t.id === tabId ? { ...t, isDirty } : t))
    );
  }

  public updateSubTab(tabId: string, subTabKey: string): void {
    this.tabsSignal.update(tabs =>
      tabs.map(t => (t.id === tabId ? { ...t, activeSubTabKey: subTabKey } : t))
    );
    this.persist();
  }

  public pruneMissingEntities(validEntityIds: Set<UUID>): void {
    this.tabsSignal.update(tabs =>
      tabs.filter(t => {
        if (!t.entityId) return true;
        return validEntityIds.has(t.entityId);
      })
    );
    if (!this.tabsSignal().some(t => t.id === this.activeTabIdSignal())) {
      this.activeTabIdSignal.set(this.tabsSignal()[0].id);
    }
    this.persist();
  }

  private confirmDiscardModal(): Promise<boolean> {
    this.isModalOpen = true;
    return new Promise(resolve => {
      let resolved = false;
      const safeResolve = (val: boolean) => {
        if (!resolved) {
          resolved = true;
          this.isModalOpen = false;
          resolve(val);
        }
      };

      const ref = this.modalService.confirm({
        nzTitle: 'Unsaved Changes Detected',
        nzContent: 'Closing this tab will discard modifications. Continue?',
        nzOkText: 'Discard & Close',
        nzOkDanger: true,
        nzOnOk: () => safeResolve(true),
        nzCancelText: 'Keep Editing',
        nzOnCancel: () => safeResolve(false)
      });

      ref.afterClose.subscribe(() => safeResolve(false));
    });
  }

  private persist(): void {
    if (!this.store) return;
    try {
      const cleanTabs = this.tabsSignal().map(t => ({ ...t, isDirty: false }));
      this.store.setItem(WORKSPACE_SESSION_KEYS.WORKSPACE_TABS, JSON.stringify(cleanTabs));
      this.store.setItem(WORKSPACE_SESSION_KEYS.ACTIVE_TAB_ID, this.activeTabIdSignal());
    } catch {
      // Storage unavailable or quota exceeded
    }
  }

  private hydrateSession(): void {
    if (!this.store) return;
    try {
      const raw = this.store.getItem(WORKSPACE_SESSION_KEYS.WORKSPACE_TABS);
      const activeId = this.store.getItem(WORKSPACE_SESSION_KEYS.ACTIVE_TAB_ID);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const allowedTypes = new Set(['ACCOUNT', 'OPPORTUNITY', 'LIST', 'DASHBOARD']);
          const allowedIcons = new Set(ICON_NAMES);

          const sanitized: WorkspaceTab[] = parsed
            .filter((t: unknown): t is WorkspaceTab => {
              if (!t || typeof t !== 'object') return false;
              const tab = t as WorkspaceTab;
              return allowedTypes.has(tab.entityType) && allowedIcons.has(tab.icon) && typeof tab.id === 'string';
            })
            .map(t => ({ ...t, isDirty: false }));

          if (!sanitized.some(t => t.id === this.defaultTab.id)) {
            sanitized.unshift(this.defaultTab);
          }

          this.tabsSignal.set(sanitized);
          if (activeId && sanitized.some(t => t.id === activeId)) {
            this.activeTabIdSignal.set(activeId);
            return;
          }
        }
      }
    } catch {
      this.tabsSignal.set([this.defaultTab]);
    }
  }
}
```

### 3.4 Multi-Criteria Filter & Sort Evaluator
`src/app/core/utils/filter-evaluator.ts`:

```typescript
import { FilterCriterion, SortCriterion } from '@core/models/crm.models';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;

function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  return path.split('.').reduce((acc: unknown, part: string) => {
    if (acc != null && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

function parseFilterComparable(val: unknown): number | string {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    if (ISO_DATE_PATTERN.test(val)) {
      const parsed = Date.parse(val);
      if (!isNaN(parsed)) return parsed;
    }
    const num = Number(val);
    if (!isNaN(num) && val.trim() !== '') return num;
    return val.toLowerCase();
  }
  return String(val ?? '').toLowerCase();
}

function parseSortComparable(val: unknown): number | string {
  if (typeof val === 'number') return val;
  if (typeof val === 'string' && ISO_DATE_PATTERN.test(val)) {
    const parsed = Date.parse(val);
    if (!isNaN(parsed)) return parsed;
  }
  return String(val ?? '').toLowerCase();
}

export function evaluateCriteria<T extends Record<string, unknown>>(
  items: T[],
  filters: FilterCriterion[],
  sorts: SortCriterion[]
): T[] {
  let result = items.filter(item => {
    return filters.every(crit => {
      const val = getNestedValue(item, crit.field);
      const isValEmpty = val === undefined || val === null || val === '';

      if (crit.operator === 'isEmpty') return isValEmpty;
      if (crit.operator === 'isNotEmpty') return !isValEmpty;

      if (isValEmpty) {
        return crit.operator === 'equals' && (crit.value === null || crit.value === '');
      }

      switch (crit.operator) {
        case 'equals':
          return String(val).toLowerCase() === String(crit.value).toLowerCase();
        case 'contains':
          return String(val).toLowerCase().includes(String(crit.value).toLowerCase());
        case 'greaterThan': {
          const compA = parseFilterComparable(val);
          const compB = parseFilterComparable(crit.value);
          if (typeof compA === 'number' && typeof compB === 'number') return compA > compB;
          return String(compA) > String(compB);
        }
        case 'lessThan': {
          const compA = parseFilterComparable(val);
          const compB = parseFilterComparable(crit.value);
          if (typeof compA === 'number' && typeof compB === 'number') return compA < compB;
          return String(compA) < String(compB);
        }
        case 'in':
          if (Array.isArray(crit.value)) {
            return crit.value.map(v => String(v).toLowerCase()).includes(String(val).toLowerCase());
          }
          return false;
        default:
          return true;
      }
    });
  });

  if (sorts.length > 0) {
    result = [...result].sort((a, b) => {
      for (const sort of sorts) {
        const fieldA = getNestedValue(a, sort.field);
        const fieldB = getNestedValue(b, sort.field);
        if (fieldA === fieldB) continue;

        const modifier = sort.direction === 'asc' ? 1 : -1;
        const aNil = fieldA == null;
        const bNil = fieldB == null;

        if (aNil && bNil) continue;
        if (aNil) return 1 * modifier;
        if (bNil) return -1 * modifier;

        const compA = parseSortComparable(fieldA);
        const compB = parseSortComparable(fieldB);

        const cmp = typeof compA === 'number' && typeof compB === 'number'
          ? compA - compB
          : String(compA).localeCompare(String(compB), undefined, { numeric: true });

        if (cmp !== 0) {
          return cmp * modifier;
        }
      }
      return 0;
    });
  }

  return result;
}
```

### 3.5 Global Keyboard Shortcut Service
`src/app/core/services/keyboard-shortcut.service.ts`:

```typescript
import { Injectable, inject, DestroyRef } from '@angular/core';
import { fromEvent, Subject } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class KeyboardShortcutService {
  private readonly destroyRef = inject(DestroyRef);

  private readonly saveSubject = new Subject<void>();
  private readonly searchSubject = new Subject<void>();
  private readonly tabCloseSubject = new Subject<void>();

  public readonly saveRequested$ = this.saveSubject.asObservable();
  public readonly searchFocusRequested$ = this.searchSubject.asObservable();
  public readonly tabCloseRequested$ = this.tabCloseSubject.asObservable();

  public init(): void {
    if (typeof document === 'undefined') return;

    fromEvent<KeyboardEvent>(document, 'keydown')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(event => {
        const target = event.target as HTMLElement | null;
        const isInputField = target && (
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
          target.isContentEditable
        );

        if (event.altKey && event.shiftKey && event.code === 'KeyW') {
          event.preventDefault();
          this.tabCloseSubject.next();
          return;
        }

        if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
          event.preventDefault();
          this.saveSubject.next();
          return;
        }

        if (event.key === '/' && !isInputField) {
          event.preventDefault();
          this.searchSubject.next();
        }
      });
  }
}
```

---

## 4. Responsive Breakpoint Specification

### 4.1 ViewportService API
`src/app/core/services/viewport.service.ts`:

```typescript
import { Injectable, inject } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class ViewportService {
  private readonly breakpointObserver = inject(BreakpointObserver);

  private readonly mobileQuery = '(max-width: 767px)';
  private readonly tabletQuery = '(min-width: 768px) and (max-width: 1023px)';
  private readonly desktopQuery = '(min-width: 1024px)';
  private readonly coarsePointerQuery = '(pointer: coarse)';

  public readonly isMobile = toSignal(
    this.breakpointObserver.observe(this.mobileQuery).pipe(map(s => s.matches)),
    { initialValue: this.breakpointObserver.isMatched(this.mobileQuery) }
  );

  public readonly isTablet = toSignal(
    this.breakpointObserver.observe(this.tabletQuery).pipe(map(s => s.matches)),
    { initialValue: this.breakpointObserver.isMatched(this.tabletQuery) }
  );

  public readonly isDesktop = toSignal(
    this.breakpointObserver.observe(this.desktopQuery).pipe(map(s => s.matches)),
    { initialValue: this.breakpointObserver.isMatched(this.desktopQuery) }
  );

  public readonly isCoarsePointer = toSignal(
    this.breakpointObserver.observe(this.coarsePointerQuery).pipe(map(s => s.matches)),
    { initialValue: this.breakpointObserver.isMatched(this.coarsePointerQuery) }
  );
}
```

### 4.2 Breakpoint Matrix
| Viewport Range | Tab Strip Layout | Primary Entity Surface | Secondary Rail / Actions | Pointer & Typography Rules |
| :--- | :--- | :--- | :--- | :--- |
| **0px - 767px (Mobile)** | Native compact select dropdown. Horizontal strip unmounted via `@if (!viewport.isMobile())`. Close icons always visible. | 100% width card stream. Chevrons collapse to current-stage badge with "Change Stage" bottom drawer. 2-column metric grid. | Rendered inside `nz-drawer` (`nzPlacement="bottom"`, height `80dvh`) triggered by sticky bottom bar (`position: sticky; bottom: 0; padding-bottom: env(safe-area-inset-bottom); height: calc(48px + env(safe-area-inset-bottom));`). | Coarse pointer rules: form controls 44px min height, 16px input font to prevent iOS zoom. No hover dependencies. |
| **768px - 1023px (Tablet)** | Horizontal strip: 3 tabs + overflow dropdown with badge count. | Stacked vertical layout without resizable splitter. Highlights bar renders in 4-column metric layout. Single date pickers. | Tabbed sub-view below primary entity records. Composer renders inline with collapsible accordions. | Touch targets 44px min under `@media (pointer: coarse)`. Dense 28px/32px tokens active only under `@media (pointer: fine)`. |
| **1024px+ (Desktop Console)** | Fixed console tab bar with dirty status dot indicator, close button, and shortcut triggers (`Alt+Shift+W`). | Pinned 65% left pane within `nz-splitter` (fallback to CSS grid `65% 35%`). Full 8-step chevron ribbon. | Pinned 35% right context utility rail (Activity Composer + chronological feed). | High-density tokens active under `@media (pointer: fine) and (min-width: 1024px)`: inputs 24px, table rows 28px, compact font hierarchy. |

### 4.3 Theme & High-Density SCSS System
`src/styles/_theme-variables.scss`:
```scss
:root {
  --slds-brand: #0176d3;
  --slds-brand-dark: #014486;
  --slds-surface: #f3f3f3;
  --slds-surface-card: #ffffff;
  --slds-border: #c9c9c9;
  --slds-text-primary: #181818;
  --slds-text-secondary: #444444;
  --slds-success: #2e844a;
  --slds-warning: #fe9339;
  --slds-error: #ea001e;
  --slds-font-size-label: 11px;
  --slds-font-size-body: 13px;
  --slds-font-size-heading: 16px;
}
```

`src/styles/_density-overrides.scss`:
```scss
@use './theme-variables' as *;

@media (pointer: fine) and (min-width: 1024px) {
  .ant-table-small .ant-table-thead > tr > th,
  .ant-table-small .ant-table-tbody > tr > td {
    padding: 4px 8px;
    font-size: var(--slds-font-size-body);
  }

  .ant-btn-sm {
    height: 24px;
    padding: 0 8px;
    font-size: var(--slds-font-size-body);
  }

  .ant-input-sm {
    height: 24px;
    font-size: var(--slds-font-size-body);
  }

  .ant-form-item {
    margin-bottom: 8px;
  }
}

@media (pointer: coarse) {
  input, select, textarea {
    font-size: 16px !important;
  }

  button, .ant-btn, .ant-table-row {
    min-height: 44px;
  }
}
```

---

## 5. Sequential Execution Queue

### Phase 1: Types, Storage/API Client Config, and Base Utilities
*   [ ] **1.1 Interface Definition**: Create `src/app/core/models/crm.models.ts` with complete definitions for `Account`, `Contact`, `Opportunity`, `OpportunityView`, `Activity`, `Address`, `WorkspaceTab`, and corresponding enums and forms (`AccountFormModel`, `ContactFormModel`, `OpportunityFormModel`, `ActivityFormModel`).
*   [ ] **1.2 Pipeline & Financial Utilities**: Implement `src/app/core/utils/pipeline-calc.ts` containing stage probabilities, revenue calculations, `toLocalDateOnly`, stage progression rules, win-rate calculations, and weighted forecast calculations.
*   [ ] **1.2.1 Resilient ID Generator**: Implement `src/app/core/utils/uuid.ts` exporting `generateId(): UUID` supporting `crypto.randomUUID()` with fallback to `crypto.getRandomValues()`.
*   [ ] **1.3 Mock Seed Fixture**: Create `src/app/core/fixtures/mock-crm-data.ts` with deterministic UUIDs and `version: 1`, seeding 10 Accounts, 25 Contacts (enforcing 1 primary per account), 15 Opportunities (with valid contact-account linkage), and 40 Activities.
*   [ ] **1.4 Viewport & Responsive Service**: Implement `src/app/core/services/viewport.service.ts` exposing `isMobile`, `isTablet`, `isDesktop`, and `isCoarsePointer` signals using CDK `BreakpointObserver`.
*   [ ] **1.5 Storage Tokens & Storage Engine**: Implement `src/app/core/tokens/crm-storage.token.ts` and `src/app/core/services/crm-storage.service.ts`. Expose public API: `load<T>(key: string): T | null`, `save<T>(key: string, data: T): void`, `changes$: Observable<{ key: string; value: unknown }>`, and `migrate(): void`. Provide memory-backed fallback when storage is inaccessible. Implement BroadcastChannel multi-window synchronization (higher `version` wins per `id`), QuotaExceededError handling, and schema migrations.
*   [ ] **1.6 Data Access Repository**: Implement `src/app/core/services/crm-repository.service.ts` managing Signals for Accounts, Contacts, Opportunities, and Activities. Expose `computed` `opportunitiesWithDerived: Signal<OpportunityView[]>` and `allEntityIds: Signal<Set<UUID>>`. Enforce domain rules without referencing `WorkspaceTabService`:
    *   Optimistic locking: `update(id, patch, expectedVersion)` verifies version match and increments version by 1; on mismatch, throws `ConflictError`.
    *   Stage transition validation: `updateOpportunityStage(id, stage, expectedVersion, lossReason?)` executes `validateStageTransition`; if invalid, throws `StageTransitionError`.
    *   Contact invariants: Setting a contact to `isPrimary: true` automatically unsets `isPrimary` on all sibling contacts of the same account. Deleting a contact is blocked if referenced as `primaryContactId` by open Opportunities; if deleting the primary contact when other contacts exist, require explicit re-assignment first.
    *   Activity date invariants: Setting status `COMPLETED` sets `completedDate` to current timestamp; un-completing sets `completedDate = null`.
    *   Cascade deletes order: Deleting an Account first removes linked Opportunities (cascading Opportunity Activities), then Contact Activities, then Contacts, and finally the Account itself.

### Phase 2: Design Foundation & Atomic UI Primitives
*   [ ] **2.1 High-Density CSS System**: Create `src/styles/_theme-variables.scss` and `src/styles/_density-overrides.scss`. Wire both into `src/styles.scss` via `@use`. Gate density overrides under `@media (pointer: fine) and (min-width: 1024px)`. Enforce 44px touch-safe targets and 16px input font under `@media (pointer: coarse)`.
*   [ ] **2.2 Compact Badge Component**: Create `src/app/shared/ui/compact-badge/compact-badge.component.ts` supporting semantic color codes for priority and status states.
*   [ ] **2.3 Metric Chip Component**: Create `src/app/shared/ui/metric-chip/metric-chip.component.ts` for record banners showing condensed financial values and count metrics.
*   [ ] **2.4 Opportunity Stage Path Component**: Create `src/app/shared/ui/stage-path/stage-path.component.ts` and `.scss` rendering responsive chevron stage ribbons with direct click transitions and terminal status triggers.
*   [ ] **2.5 Custom Pipes**: Create `src/app/shared/pipes/currency-formatter.pipe.ts` (USD compact millions/thousands formatting) and `src/app/shared/pipes/stage-color.pipe.ts` (hex/token resolution per stage).

### Phase 3: Compound Molecules & Feature Components
*   [ ] **3.1 Dense Table Toolbar**: Create `src/app/shared/ui/dense-table-toolbar/dense-table-toolbar.component.ts` featuring search input, filter popover trigger, column visibility picker, and density switcher.
*   [ ] **3.2 Activity Timeline Feed**: Create `src/app/shared/ui/activity-timeline/activity-timeline.component.ts` and `.scss` rendering logged tasks/calls/notes with instant check-to-complete toggles.
*   [ ] **3.3 Activity Action Composer**: Create `src/app/features/activities/activity-composer/activity-composer.component.ts` tabbed widget for Log a Call, Create Task, Add Note with validation and immediate signal store propagation.
*   [ ] **3.4 Entity Related-Lists Card**: Create `src/app/shared/ui/related-entity-card/related-entity-card.component.ts` and `.scss` displaying compact linked sub-grids with inline quick-add action triggers.
*   [ ] **3.5 Record Banner Header**: Create `src/app/shared/ui/record-banner/record-banner.component.ts` and `.scss` supporting entity icons, 2-to-4 column responsive metric chips, and an action button cluster.
*   [ ] **3.6 Quick Create Drawer**: Create `src/app/shared/ui/quick-create-drawer/quick-create-drawer.component.ts` and `.scss` implementing dynamic entity creation and editing (`mode: 'create' | 'edit'`, `recordId`) for Accounts, Contacts, Opportunities, and Activities.

### Phase 4: Domain Logic, Reactive State, and Specialized Workflows
*   [ ] **4.1 Workspace Tab Service**: Implement `src/app/core/services/workspace-tab.service.ts` to manage multi-document tabs, tab switching, subtab state updates, close validation with `NzModalService`, dirty state, and sessionStorage persistence.
*   [ ] **4.2 Opportunity Lifecycle Engine**: Integrate `src/app/core/utils/pipeline-calc.ts` with repository workflows, validating stage transitions, enforcing `applyStageTransition` with `toLocalDateOnly()`, handling closed-lost reason persistence, and recalculating forecast metrics.
*   [ ] **4.3 Multi-Criteria Filtering Engine**: Implement `src/app/core/utils/filter-evaluator.ts` exposing `evaluateCriteria` supporting nested path access, ISO-date awareness, empty/non-empty operations, and antisymmetric multi-column sorting with `{ numeric: true }`.
*   [ ] **4.4 Keyboard Shortcut Service**: Implement `src/app/core/services/keyboard-shortcut.service.ts` listening to `keydown` events via `fromEvent<KeyboardEvent>(document, 'keydown')`. Match physical key `event.code === 'KeyW'` with `event.altKey && event.shiftKey` for tab close, `(event.ctrlKey || event.metaKey) && event.code === 'KeyS'` (calling `preventDefault()`) for save, and `event.key === '/'` for search (suppressed when target is an input field). Expose `saveRequested$`, `searchFocusRequested$`, and `tabCloseRequested$` observables.

### Phase 5: Complete Page/Screen Assembly & Responsive Shell
*   [ ] **5.1 Console Navigation & Utility Bar**: Create `src/app/features/workspace/components/console-tab-bar/console-tab-bar.component.ts` (tabs with dirty indicator dots, overflow menu) and `src/app/features/workspace/components/utility-bar/utility-bar.component.ts` (sticky status bar with quick-create action triggers).
*   [ ] **5.2 Pipeline Dashboard Component**: Implement `src/app/features/workspace/pipeline-dashboard/pipeline-dashboard.component.ts` and `.scss` rendering key metrics cards (Total Pipeline Value, Weighted Forecast, Win Rate, Stage Breakdown) using pure CSS progress bars without third-party chart dependencies.
*   [ ] **5.3 Account Detail Workspace**: Assemble `src/app/features/accounts/account-detail/account-detail.component.ts` and `.scss` with split pane layout (Account fields + Contacts grid on left, Activities + Opportunities on right) and reactive form dirty tracking calling `tabService.setTabDirty`.
*   [ ] **5.4 Opportunity Detail Workspace**: Assemble `src/app/features/opportunities/opportunity-detail/opportunity-detail.component.ts` and `.scss` alongside `src/app/features/opportunities/components/loss-reason-modal/loss-reason-modal.component.ts`. Integrate Stage Chevron Path with `applyStageTransition`, Loss Reason modal on `CLOSED_LOST`, Activity Composer, and Related Lists.
*   [ ] **5.5 Enterprise Data Grids**: Implement `AccountListComponent` and `OpportunityListComponent` utilizing standard NG-ZORRO compact tables (`nzSize="small"`) with dense client-side pagination (`pageSize: 25`), multi-column sorting, and responsive card swapping below 768px.
*   [ ] **5.6 Responsive Mobile Adaptation**: Implement off-canvas drawer mode for right utility panes and dropdown selector for console tabs below 768px.
*   [ ] **5.7 Main Shell & Root Integration**: Assemble `WorkspaceShellComponent` with keep-alive tab outlet mapping (`@for` with `[hidden]`), instantiate a single `QuickCreateDrawerComponent` wired to `UtilityBarComponent.quickActionClick`, and establish an Angular effect linking `repository.allEntityIds()` to `tabService.pruneMissingEntities()`. Finally, update `src/app/app.component.ts` to mount `<app-workspace-shell />`.