// Delete proposal controller
import { Request, Response } from 'express';
import { prismaClient } from '../lib/prisma';

export const deleteProposal = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if proposal exists
    const proposal = await prismaClient.proposal.findUnique({
      where: { id },
      include: {
        vendor: true,
        rfp: true,
      },
    });

    if (!proposal) {
      return res.status(404).json({
        success: false,
        error: 'Proposal not found',
      });
    }

    // Delete the proposal
    await prismaClient.proposal.delete({
      where: { id },
    });

    // Update RFPVendor status back to SENT if needed
    await prismaClient.rFPVendor.updateMany({
      where: {
        rfpId: proposal.rfpId,
        vendorId: proposal.vendorId,
      },
      data: {
        status: 'SENT',
      },
    });

    console.log(`✅ Deleted proposal ${id} from vendor ${proposal.vendor.name}`);

    return res.status(200).json({
      success: true,
      message: 'Proposal deleted successfully',
    });
  } catch (error: any) {
    console.error('Error deleting proposal:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete proposal',
    });
  }
};
