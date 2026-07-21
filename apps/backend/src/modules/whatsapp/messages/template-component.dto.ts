import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Meta template "parameters" entry. We only send text params today; declaring
 * `type` + `text` is what lets them survive the global ValidationPipe
 * (whitelist + transform). An untyped Record<> here was being collapsed to an
 * empty array by the pipe, producing the malformed `components: [[]]` that Meta
 * rejected with error 100 ("template.components.0 ... missing : 'type'").
 */
export class TemplateParamDto {
  @IsString() type!: string;
  @IsOptional() @IsString() text?: string;
}

/**
 * Meta template component (header / body / button). `parameters` is preserved
 * + validated via @ValidateNested + @Type so the nested structure survives.
 *
 * Shared by the thread-keyed send (messages.controller) and the lead-keyed
 * first-contact send (lead-outreach.controller) so both validate identically —
 * a divergence here is what produces Meta error 100 / 132000 at send time.
 */
export class TemplateComponentDto {
  @IsString() type!: string;
  @IsOptional() @IsString() sub_type?: string;
  @IsOptional() @IsString() index?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateParamDto)
  parameters?: TemplateParamDto[];
}
