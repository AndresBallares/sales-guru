"""Shared pieces of the Optimizer's proposals that can't be applied yet."""


class ProposalNotBuiltError(NotImplementedError):
    """Approving this proposal does nothing yet: its action isn't built.

    The approval is recorded as interest only; the proposal stays pending and
    nothing is created on Meta. The approve endpoint turns it into a 409.
    """
