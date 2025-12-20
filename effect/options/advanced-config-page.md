# Advanced Config Page - Effect.ts Refactoring

## Overview

This file is the Effect.ts refactored version of the Advanced Configuration page module from the Bookmark RAG extension. It provides a UI for viewing and editing advanced configuration settings.

## Location

- **Original**: `/home/user/bookmarks/src/options/modules/advanced-config.ts`
- **Refactored**: `/home/user/bookmarks/effect/options/advanced-config-page.ts`

## Key Changes

### 1. Services Introduced

#### DOMService
Provides DOM manipulation and event handling capabilities as Effects:
- `getElementById`: Get element by ID with typed error handling
- `querySelector`: Query for elements
- `addEventListener`: Register event listeners
- `clearChildren`, `appendChild`, `replaceChildren`: DOM manipulation
- `focus`, `select`: Focus management
- `confirm`: User confirmation dialogs

#### StatusNotificationService
Handles status message display:
- `showStatus`: Show success/error messages to the user

#### UIStateService
Manages UI state in an Effect context:
- `getEditingKey`, `setEditingKey`: Track which config entry is being edited
- `getSearchQuery`, `getCategoryFilter`, `getShowModifiedOnly`: Get current filter state

### 2. Error Types

#### DOMError
Typed error for DOM operations with codes:
- `ELEMENT_NOT_FOUND`
- `INVALID_SELECTOR`
- `DOM_MANIPULATION_FAILED`

### 3. Integration with ConfigService

The module uses the `ConfigService` from `effect/lib/config-registry.ts` which provides:
- `ensureLoaded`: Ensure configuration is loaded
- `getAllEntries`: Get all configuration entries with metadata
- `searchEntries`: Search configuration entries
- `setValue`: Set a configuration value
- `resetValue`: Reset a value to default
- `resetAll`: Reset all values to defaults
- `getModifiedCount`: Get count of modified entries

### 4. Effect.gen Composition

All async operations are composed using `Effect.gen`:
- `initAdvancedConfigModule`: Initialize the module
- `populateCategoryFilter`: Populate category dropdown
- `setupEventListeners`: Set up event handlers
- `renderConfigTable`: Render the configuration table
- `getFilteredEntries`: Get filtered config entries
- `startEditing`, `cancelEditing`, `saveEdit`, `resetValue`: Edit operations
- `handleResetAll`: Reset all configurations
- `updateModifiedCount`: Update modified count display

### 5. Layer Architecture

Three layers are composed together:
- `DOMServiceLive`: Production DOM service implementation
- `StatusNotificationServiceLive`: Production status notification service
- `UIStateServiceLive`: Production UI state service
- `AdvancedConfigPageLayer`: Combined layer for all page services

### 6. Public API

The module exports:
- `initAdvancedConfigModule`: Main initialization Effect
- `runInitAdvancedConfigModule`: Helper to run initialization with proper layers
- Service definitions: `DOMService`, `StatusNotificationService`, `UIStateService`
- Error types: `DOMError`
- Layer: `AdvancedConfigPageLayer`

## Usage

```typescript
import { runInitAdvancedConfigModule } from './effect/options/advanced-config-page';
import { ConfigServiceLive } from './effect/lib/config-registry';

// Initialize the advanced config page
await runInitAdvancedConfigModule(ConfigServiceLive);
```

## Benefits

1. **Testability**: All services can be mocked via layers for testing
2. **Type Safety**: Typed errors provide better error handling
3. **Composability**: Effects can be composed and transformed
4. **Resource Safety**: DOM operations and event listeners are properly managed
5. **Dependency Injection**: Services are injected via layers
6. **Error Context**: Typed errors preserve operation context

## Architecture Alignment

This refactoring follows the Effect.ts patterns from `EFFECT_REFACTOR.md`:
- ✅ Context.Tag for services
- ✅ Data.TaggedError for typed errors
- ✅ Effect.gen for composition
- ✅ Layer for dependency injection
- ✅ Maintains same public API where possible
