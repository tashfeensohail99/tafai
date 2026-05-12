import type { ChangeEvent } from 'react';

export interface FilterOption {
  label: string;
  value: string;
}

export interface FilterField {
  key: string;
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

interface FilterBarProps {
  searchValue?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  filters?: FilterField[];
  onClear?: () => void;
}

export function FilterBar({
  searchValue = '',
  searchPlaceholder = 'Search...',
  onSearchChange,
  filters = [],
  onClear,
}: FilterBarProps) {
  return (
    <div className="mb-6 rounded-[24px] border p-4 shadow-sm sm:p-5" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
        {onSearchChange ? (
          <input
            value={searchValue}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none md:min-w-[260px] md:flex-1"
            style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}
          />
        ) : null}

        {filters.map((filter) => (
          <label key={filter.key} className="flex w-full flex-col gap-1 text-xs font-medium sm:min-w-[180px] sm:flex-1 md:w-auto md:flex-none" style={{ color: 'var(--sos-text-muted)' }}>
            {filter.label}
            <select
              value={filter.value}
              onChange={(event) => filter.onChange(event.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none"
              style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)', color: 'var(--sos-text-primary)' }}
            >
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}

        {onClear ? (
          <button
            onClick={onClear}
            className="w-full rounded-md border px-3 py-2 text-sm font-medium sm:w-auto"
            style={{ borderColor: 'var(--sos-border-subtle)', color: 'var(--sos-text-secondary)' }}
          >
            Clear Filters
          </button>
        ) : null}
      </div>
    </div>
  );
}