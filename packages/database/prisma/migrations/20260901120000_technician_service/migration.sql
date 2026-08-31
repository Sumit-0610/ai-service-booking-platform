-- CreateTable
CREATE TABLE "TechnicianService" (
    "id" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechnicianService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechnicianService_serviceId_idx" ON "TechnicianService"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicianService_technicianId_serviceId_key" ON "TechnicianService"("technicianId", "serviceId");

-- AddForeignKey
ALTER TABLE "TechnicianService" ADD CONSTRAINT "TechnicianService_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianService" ADD CONSTRAINT "TechnicianService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

