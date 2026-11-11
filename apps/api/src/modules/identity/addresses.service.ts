import { HttpStatus, Injectable } from '@nestjs/common';
import { type Address, type AddressInput, addressInputSchema, MAX_ADDRESSES } from '@xatu/shared';
import { AppError } from '../../common/errors.js';
import type { Address as AddressRow } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

type CleanAddress = ReturnType<typeof addressInputSchema.parse>;

/** A buyer's saved delivery addresses. Every call is scoped to the caller; deletes are soft. */
@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<Address[]> {
    const rows = await this.prisma.address.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toView);
  }

  async create(userId: string, input: CleanAddress): Promise<Address> {
    const count = await this.prisma.address.count({ where: { userId, deletedAt: null } });
    if (count >= MAX_ADDRESSES) {
      throw new AppError(
        'too_many_addresses',
        `You can save up to ${MAX_ADDRESSES} addresses.`,
        HttpStatus.CONFLICT,
      );
    }
    const row = await this.prisma.address.create({
      data: {
        userId,
        ...input,
        line2: input.line2 ?? null,
        landmark: input.landmark ?? null,
        isDefault: count === 0,
      },
    });
    return toView(row);
  }

  async update(userId: string, id: string, patch: Partial<CleanAddress>): Promise<Address> {
    await this.owned(userId, id);
    return toView(await this.prisma.address.update({ where: { id }, data: patch }));
  }

  async remove(userId: string, id: string): Promise<void> {
    const row = await this.owned(userId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.address.update({ where: { id }, data: { deletedAt: new Date(), isDefault: false } });
      if (row.isDefault) {
        const next = await tx.address.findFirst({
          where: { userId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
        });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }

  /** For orders: the caller's live address, or 404 (someone else's looks the same as missing). */
  async owned(userId: string, id: string): Promise<AddressRow> {
    const row = await this.prisma.address.findFirst({ where: { id, userId, deletedAt: null } });
    if (!row)
      throw new AppError(
        'address_not_found',
        'This address is not available.',
        HttpStatus.NOT_FOUND,
      );
    return row;
  }
}

export function toView(a: AddressRow): Address {
  return {
    id: a.id,
    name: a.name,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2,
    landmark: a.landmark,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    isDefault: a.isDefault,
  };
}

export type { AddressInput };
