import type { ReactNode } from 'react';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
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
}: DataTableProps<T>) {
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
