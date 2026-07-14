import { IsIn } from 'class-validator';

/** Lead-detail WhatsApp button mode carried on the mobile manifest. */
export class SetLeadWhatsappModeDto {
  @IsIn(['personal', 'crm'])
  leadWhatsappMode!: 'personal' | 'crm';
}
