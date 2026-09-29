import { JrDatabankController } from './jr-databank.controller';
import type { DatabankService } from './databank.service';
import type { DatabankUploadService } from './databank-upload.service';
import type { SearchDatabankDto, UpdateFileDto } from './databank.dto';

/**
 * JR databank parity for the P2 search + file-metadata endpoints. The JR
 * controller is a thin view onto the SAME shared DatabankService, so these
 * tests just prove the two new handlers delegate correctly (and parse
 * folderId/types the same way the Processing controller does). The service is
 * mocked — no DB, no permission guard (that's covered by the service specs).
 */

const USER = { id: 'jr1', permissions: ['jr.portal.view'] } as never;

function harness() {
  const databank = {
    searchDatabank: jest.fn().mockResolvedValue({
      results: [],
      total: 0,
      page: 1,
      pageSize: 50,
      facets: { byType: { image: 0, pdf: 0, video: 0, audio: 0, office: 0, other: 0 }, total: 0 },
    }),
    updateFile: jest.fn().mockResolvedValue({ id: 'f1' }),
  };
  const uploads = {} as DatabankUploadService;
  const ctrl = new JrDatabankController(databank as unknown as DatabankService, uploads);
  return { ctrl, databank };
}

describe('JrDatabankController search + updateFile parity', () => {
  it('GET /jr/databank/search delegates to databank.searchDatabank with parsed folderId/types', () => {
    const { ctrl, databank } = harness();
    const dto: SearchDatabankDto = {
      clientId: 'c1',
      q: 'passport',
      folderId: 'root',
      types: 'pdf, image ,',
      page: 2,
      pageSize: 25,
    };

    void ctrl.search(dto, USER);

    expect(databank.searchDatabank).toHaveBeenCalledWith(USER, {
      clientId: 'c1',
      personal: undefined,
      q: 'passport',
      folderId: null, // 'root' → the databank root
      types: ['pdf', 'image'], // split on commas, trimmed, empties dropped
      page: 2,
      pageSize: 25,
    });
  });

  it('search: a real folder id passes through and an omitted folderId stays undefined (any folder)', () => {
    const { ctrl, databank } = harness();

    void ctrl.search({ personal: true, q: 'x', folderId: 'abc-123' }, USER);
    expect(databank.searchDatabank).toHaveBeenLastCalledWith(
      USER,
      expect.objectContaining({ personal: true, folderId: 'abc-123', types: undefined }),
    );

    void ctrl.search({ personal: true }, USER);
    expect(databank.searchDatabank).toHaveBeenLastCalledWith(
      USER,
      expect.objectContaining({ folderId: undefined, types: undefined }),
    );
  });

  it('PATCH /jr/databank/files/:fileId delegates to databank.updateFile (rename + metadata)', () => {
    const { ctrl, databank } = harness();
    const dto: UpdateFileDto = { fileName: 'renamed.pdf', description: 'note', tags: ['a', 'b'] };

    void ctrl.updateFile('file-1', dto, USER);

    expect(databank.updateFile).toHaveBeenCalledWith('file-1', dto, USER);
  });
});
