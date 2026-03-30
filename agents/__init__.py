"""
Ghost Protocol — Agent System
==============================
17 AI-Agenten, 4 Tiers, 1 Mission.

Tier 0 (Brain):     STRATEGIST, DONNA
Tier 1 (C-Suite):   OPERATOR, ORACLE, ARCHITECT, TREASURER, PUBLISHER, COUNSEL
Tier 2 (Directors): AMPLIFIER, MERCHANT, RESEARCHER
Tier 3 (Operators): SCRIBE, TRADER, GUARDIAN, CONCIERGE, LOCALIZER

Legacy imports (CrewAI config) remain for backward compatibility.
New system uses BaseAgent architecture with Message Bus + RAG.
"""

from agents.config import LLM_COMPLEX, LLM_SIMPLE

# New Architecture Imports
from agents.base_agent import (
    AgentConfig,
    AgentMessage,
    AgentTier,
    BaseAgent,
    MessageBus,
    MessagePriority,
    MessageType,
)

__all__ = [
    "LLM_COMPLEX",
    "LLM_SIMPLE",
    "AgentConfig",
    "AgentMessage",
    "AgentTier",
    "BaseAgent",
    "MessageBus",
    "MessagePriority",
    "MessageType",
]
