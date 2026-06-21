import type { ReactNode } from 'react';

export interface DataTableColumn<T> {
  key: string;
  // ReactNode so callers can put a checkbox or icon in the header (used by
  // ResourceManager's bulk-select column). Strings keep working as before.
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
}

export interface DataTablePagination {
  /** 1-based current page. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
  /**
   * Optional server-side pagination. When provided, a glass footer bar renders
   * inside the panel with a "Showing X–Y of Z" range and Prev/Next controls.
   * When omitted, no footer renders — existing callers are unaffected.
   */
  pagination?: DataTablePagination;
}

/**
 * Premium glass-morphism data table. Drop-in replacement for the legacy
 * version — same props, much nicer rendering. Sits naturally inside a
 * GlassCard or as a standalone surface; the outer shell is rendered as
 * a glass panel so callers don't need to wrap it.
 */
export function DataTable<T>({
  columns,
  data,
  rowKey,
  emptyMessage = 'No records found.',
  pagination,
}: DataTableProps<T>) {
  const pageCount = pagination
    ? Math.max(1, Math.ceil(pagination.total / Math.max(1, pagination.pageSize)))
    : 1;
  const currentPage = pagination ? Math.min(Math.max(1, pagination.page), pageCount) : 1;
  const rangeStart =
    pagination && pagination.total > 0 ? (currentPage - 1) * pagination.pageSize + 1 : 0;
  const rangeEnd = pagination
    ? Math.min(currentPage * pagination.pageSize, pagination.total)
    : 0;

  return (
    <div
      className="sos-glass sos-glass--panel"
      style={{
        padding: 0,
        overflow: 'hidden',
        borderRadius: 'var(--sos-radius-panel)',
      }}
    >
      <div className="overflow-x-auto sos-scroll">
        <table className="min-w-[720px] w-full" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="whitespace-nowrap text-left"
                  style={{
                    padding: '14px 18px',
                    background: 'var(--sos-surface-1)',
                    borderBottom: '1px solid var(--sos-border-subtle)',
                    color: 'var(--sos-text-muted)',
                    fontSize: 'var(--sos-text-xs)',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--sos-letter-eyebrow)',
                  }}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="text-center"
                  style={{
                    padding: '48px 16px',
                    color: 'var(--sos-text-muted)',
                    fontSize: 'var(--sos-text-sm)',
                  }}
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row, idx) => (
                <tr
                  key={rowKey(row)}
                  className="sos-data-row"
                  style={{
                    borderTop:
                      idx === 0 ? 'none' : '1px solid var(--sos-border-subtle)',
                    transition: 'background 150ms',
                  }}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`align-middle break-words ${column.className ?? ''}`}
                      style={{
                        padding: '14px 18px',
                        color: 'var(--sos-text-secondary)',
                        fontSize: 'var(--sos-text-base)',
                      }}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pagination ? (
        <div
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--sos-border-subtle)',
            background: 'var(--sos-surface-1)',
          }}
        >
          <span style={{ color: 'var(--sos-text-muted)', fontSize: 'var(--sos-text-xs)' }}>
            {pagination.total > 0 ? (
              <>
                Showing{' '}
                <strong style={{ color: 'var(--sos-text-secondary)' }}>
                  {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()}
                </strong>{' '}
                of <strong style={{ color: 'var(--sos-text-secondary)' }}>{pagination.total.toLocaleString()}</strong>
              </>
            ) : (
              'No results'
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => pagination.onPageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              className="rounded-md px-3 py-1.5 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                border: '1px solid var(--sos-border-subtle)',
                background: 'var(--sos-surface-2)',
                color: 'var(--sos-text-secondary)',
                fontSize: 'var(--sos-text-xs)',
              }}
            >
              Prev
            </button>
            <span
              className="whitespace-nowrap"
              style={{ color: 'var(--sos-text-muted)', fontSize: 'var(--sos-text-xs)' }}
            >
              Page <strong style={{ color: 'var(--sos-text-secondary)' }}>{currentPage}</strong> of{' '}
              <strong style={{ color: 'var(--sos-text-secondary)' }}>{pageCount}</strong>
            </span>
            <button
              type="button"
              onClick={() => pagination.onPageChange(currentPage + 1)}
              disabled={currentPage >= pageCount}
              className="rounded-md px-3 py-1.5 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                border: '1px solid var(--sos-border-subtle)',
                background: 'var(--sos-surface-2)',
                color: 'var(--sos-text-secondary)',
                fontSize: 'var(--sos-text-xs)',
              }}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
      <div
        className="sm:hidden"
        style={{
          padding: '10px 18px',
          borderTop: '1px solid var(--sos-border-subtle)',
          color: 'var(--sos-text-muted)',
          fontSize: 'var(--sos-text-xs)',
          background: 'var(--sos-surface-1)',
        }}
      >
        Swipe horizontally to view all columns.
      </div>
    </div>
  );
}
