import 'dotenv/config';
import { prisma } from './client.js';
import { Role } from '../generated/prisma/index.js';

/**
 * Deterministic development seed. Safe to run repeatedly: catalogue and people
 * are upserted by natural key, and availability is fully rebuilt each run.
 *
 * This data exists only to make local development and tests useful. It is not
 * production data and contains no real metrics.
 *
 * Every seeded account has the SAME development password: `aisbp-dev-password`.
 * The value below is a real Argon2id hash of that string, precomputed so this
 * package needs no password-hashing dependency. It is a well-known dev
 * credential, never a production secret.
 */

const DEV_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$H+d9YbwGkKYmAbw1BBZLGw$e4ByyrkYaWA34w1z+VpeyuBAo8paUH8PlE44y+LHVjA';

const users = [
  {
    id: 'seed-user-customer-alice',
    email: 'alice@example.com',
    name: 'Alice Customer',
    role: Role.customer,
  },
  {
    id: 'seed-user-customer-bob',
    email: 'bob@example.com',
    name: 'Bob Customer',
    role: Role.customer,
  },
  {
    id: 'seed-user-operations-olivia',
    email: 'olivia@ops.example.com',
    name: 'Olivia Operations',
    role: Role.operations,
  },
  {
    id: 'seed-user-technician-tomas',
    email: 'tomas@tech.example.com',
    name: 'Tomas Field',
    role: Role.technician,
  },
  {
    id: 'seed-user-technician-tara',
    email: 'tara@tech.example.com',
    name: 'Tara Bolt',
    role: Role.technician,
  },
] as const;

const addresses = [
  {
    id: 'seed-address-alice-home',
    userId: 'seed-user-customer-alice',
    label: 'Home',
    line1: 'Flat 4B, Rosewood Apartments',
    line2: 'Baner Road',
    city: 'Pune',
    state: 'Maharashtra',
    postalCode: '411045',
    country: 'IN',
  },
  {
    id: 'seed-address-alice-parents',
    userId: 'seed-user-customer-alice',
    label: "Parents' house",
    line1: '22 Nehru Layout',
    line2: null,
    city: 'Nagpur',
    state: 'Maharashtra',
    postalCode: '440001',
    country: 'IN',
  },
  {
    id: 'seed-address-bob-home',
    userId: 'seed-user-customer-bob',
    label: 'Home',
    line1: '17, 3rd Cross, Indiranagar',
    line2: 'Near BDA Complex',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560038',
    country: 'IN',
  },
] as const;

const categories = [
  {
    id: 'seed-category-appliance',
    name: 'Appliance Installation',
    slug: 'appliance-installation',
    description: 'Installation and setup of household appliances.',
    active: true,
  },
  {
    id: 'seed-category-networking',
    name: 'Home Networking',
    slug: 'home-networking',
    description: 'Wi-Fi, mesh, and wired home network setup.',
    active: true,
  },
  {
    id: 'seed-category-smart-home',
    name: 'Smart Home',
    slug: 'smart-home',
    description: 'Smart doorbells, cameras, thermostats, and hubs.',
    active: true,
  },
] as const;

const services = [
  {
    id: 'seed-service-washing-machine',
    categoryId: 'seed-category-appliance',
    name: 'Washing Machine Installation',
    slug: 'washing-machine-installation',
    description: 'Connect and level a washing machine, test a full cycle.',
    basePriceCents: 8900,
    estimatedDurationMinutes: 90,
    active: true,
  },
  {
    id: 'seed-service-dishwasher',
    categoryId: 'seed-category-appliance',
    name: 'Dishwasher Installation',
    slug: 'dishwasher-installation',
    description: 'Fit a dishwasher, connect water and drain, run a test cycle.',
    basePriceCents: 9900,
    estimatedDurationMinutes: 90,
    active: true,
  },
  {
    id: 'seed-service-refrigerator',
    categoryId: 'seed-category-appliance',
    name: 'Refrigerator Setup',
    slug: 'refrigerator-setup',
    description: 'Position a refrigerator, connect a water line, verify cooling.',
    basePriceCents: 6500,
    estimatedDurationMinutes: 60,
    active: true,
  },
  {
    id: 'seed-service-wifi-mesh',
    categoryId: 'seed-category-networking',
    name: 'Wi-Fi Mesh Setup',
    slug: 'wifi-mesh-setup',
    description: 'Install and tune a multi-node mesh network for whole-home coverage.',
    basePriceCents: 12000,
    estimatedDurationMinutes: 120,
    active: true,
  },
  {
    id: 'seed-service-smart-doorbell',
    categoryId: 'seed-category-smart-home',
    name: 'Smart Doorbell Installation',
    slug: 'smart-doorbell-installation',
    description: 'Mount and wire a smart doorbell, connect it to the home app.',
    basePriceCents: 7500,
    estimatedDurationMinutes: 60,
    active: true,
  },
  {
    id: 'seed-service-oven',
    categoryId: 'seed-category-appliance',
    name: 'Oven and Cooktop Installation',
    slug: 'oven-cooktop-installation',
    description:
      'Install a built-in oven or cooktop, connect it to power or gas, and check every element.',
    basePriceCents: 13500,
    estimatedDurationMinutes: 120,
    active: true,
  },
  {
    id: 'seed-service-dryer',
    categoryId: 'seed-category-appliance',
    name: 'Tumble Dryer Installation',
    slug: 'tumble-dryer-installation',
    description:
      'Position a tumble dryer, fit the vent hose or condenser tray, and run a heat test.',
    basePriceCents: 8200,
    estimatedDurationMinutes: 75,
    active: true,
  },
  {
    id: 'seed-service-range-hood',
    categoryId: 'seed-category-appliance',
    name: 'Range Hood Installation',
    slug: 'range-hood-installation',
    description: 'Mount an extractor hood, connect ducting or a carbon filter, and test the fan.',
    basePriceCents: 11000,
    estimatedDurationMinutes: 90,
    active: true,
  },
  {
    id: 'seed-service-ethernet',
    categoryId: 'seed-category-networking',
    name: 'Wired Ethernet Point',
    slug: 'wired-ethernet-point',
    description: 'Run and terminate a single Cat6 line from your router to a new wall outlet.',
    basePriceCents: 9500,
    estimatedDurationMinutes: 90,
    active: true,
  },
  {
    id: 'seed-service-network-tune',
    categoryId: 'seed-category-networking',
    name: 'Home Network Health Check',
    slug: 'home-network-health-check',
    description:
      'Survey Wi-Fi coverage, update firmware, tidy cabling, and hand over a short report.',
    basePriceCents: 6000,
    estimatedDurationMinutes: 60,
    active: true,
  },
  {
    id: 'seed-service-thermostat',
    categoryId: 'seed-category-smart-home',
    name: 'Smart Thermostat Installation',
    slug: 'smart-thermostat-installation',
    description: 'Swap in a smart thermostat, wire the boiler connection, and set up schedules.',
    basePriceCents: 8800,
    estimatedDurationMinutes: 75,
    active: true,
  },
  {
    id: 'seed-service-camera',
    categoryId: 'seed-category-smart-home',
    name: 'Security Camera Installation',
    slug: 'security-camera-installation',
    description: 'Mount up to two outdoor cameras, run power, and configure motion alerts.',
    basePriceCents: 14000,
    estimatedDurationMinutes: 120,
    active: true,
  },
  {
    id: 'seed-service-smart-lock',
    categoryId: 'seed-category-smart-home',
    name: 'Smart Lock Installation',
    slug: 'smart-lock-installation',
    description: 'Fit a smart lock to a standard door, calibrate it, and add your first key codes.',
    basePriceCents: 9200,
    estimatedDurationMinutes: 60,
    active: true,
  },
  {
    id: 'seed-service-legacy-tv-mount',
    categoryId: 'seed-category-smart-home',
    name: 'Legacy TV Wall Mount',
    slug: 'legacy-tv-wall-mount',
    description: 'Retired offering, kept inactive to exercise catalogue filtering.',
    basePriceCents: 5500,
    estimatedDurationMinutes: 60,
    active: false,
  },
] as const;

const technicians = [
  {
    id: 'seed-technician-tomas',
    userId: 'seed-user-technician-tomas',
    displayName: 'Tomas Field',
    serviceArea: 'Metro North',
    active: true,
  },
  {
    id: 'seed-technician-tara',
    userId: 'seed-user-technician-tara',
    displayName: 'Tara Bolt',
    serviceArea: 'Metro South',
    active: true,
  },
] as const;

/**
 * Which service each technician offers slots for. Each technician gets one
 * window per plan entry per day, and the windows are disjoint, so a technician
 * never has two overlapping slots (the database enforces this as well).
 */
const slotPlan = [
  { technicianId: 'seed-technician-tomas', serviceId: 'seed-service-washing-machine' },
  { technicianId: 'seed-technician-tomas', serviceId: 'seed-service-dishwasher' },
  { technicianId: 'seed-technician-tara', serviceId: 'seed-service-wifi-mesh' },
  { technicianId: 'seed-technician-tara', serviceId: 'seed-service-smart-doorbell' },
] as const;

const DAILY_WINDOWS = [
  { startHour: 9, endHour: 11 },
  { startHour: 13, endHour: 15 },
] as const;

const SEED_DAYS = 7;

interface SlotRow {
  technicianId: string;
  serviceId: string;
  startsAt: Date;
  endsAt: Date;
}

function buildSlots(): SlotRow[] {
  const midnightUtcToday = new Date();
  midnightUtcToday.setUTCHours(0, 0, 0, 0);

  const plansByTechnician = new Map<string, string[]>();
  for (const plan of slotPlan) {
    const list = plansByTechnician.get(plan.technicianId) ?? [];
    list.push(plan.serviceId);
    plansByTechnician.set(plan.technicianId, list);
  }

  const rows: SlotRow[] = [];
  for (let dayOffset = 1; dayOffset <= SEED_DAYS; dayOffset += 1) {
    for (const [technicianId, serviceIds] of plansByTechnician) {
      serviceIds.forEach((serviceId, planIndex) => {
        const window = DAILY_WINDOWS[planIndex % DAILY_WINDOWS.length];
        if (!window) {
          return;
        }

        const startsAt = new Date(midnightUtcToday);
        startsAt.setUTCDate(startsAt.getUTCDate() + dayOffset);
        startsAt.setUTCHours(window.startHour, 0, 0, 0);

        const endsAt = new Date(startsAt);
        endsAt.setUTCHours(window.endHour, 0, 0, 0);

        rows.push({ technicianId, serviceId, startsAt, endsAt });
      });
    }
  }

  return rows;
}

async function main(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const user of users) {
      await tx.user.upsert({
        where: { email: user.email },
        create: { ...user, passwordHash: DEV_PASSWORD_HASH },
        update: { name: user.name, role: user.role },
      });
    }

    for (const address of addresses) {
      await tx.address.upsert({
        where: { id: address.id },
        create: address,
        update: address,
      });
    }

    for (const category of categories) {
      await tx.serviceCategory.upsert({
        where: { slug: category.slug },
        create: category,
        update: { name: category.name, description: category.description, active: category.active },
      });
    }

    for (const service of services) {
      await tx.service.upsert({
        where: { slug: service.slug },
        create: service,
        update: {
          categoryId: service.categoryId,
          name: service.name,
          description: service.description,
          basePriceCents: service.basePriceCents,
          estimatedDurationMinutes: service.estimatedDurationMinutes,
          active: service.active,
        },
      });
    }

    for (const technician of technicians) {
      await tx.technician.upsert({
        where: { userId: technician.userId },
        create: technician,
        update: {
          displayName: technician.displayName,
          serviceArea: technician.serviceArea,
          active: technician.active,
        },
      });
    }

    // Availability is rebuilt from scratch each run so slots always sit in the
    // near future. Seeded slots have no bookings, so this is safe.
    await tx.availabilitySlot.deleteMany({
      where: { technicianId: { in: technicians.map((t) => t.id) } },
    });
    await tx.availabilitySlot.createMany({ data: buildSlots() });
  });

  const [userCount, serviceCount, activeServiceCount, slotCount] = await Promise.all([
    prisma.user.count(),
    prisma.service.count(),
    prisma.service.count({ where: { active: true } }),
    prisma.availabilitySlot.count(),
  ]);

  console.log(
    `Seed complete: ${userCount} users, ${serviceCount} services ` +
      `(${activeServiceCount} active), ${slotCount} availability slots.`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('Seed failed:', error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
