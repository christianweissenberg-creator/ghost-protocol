"""
Ghost Protocol — Agent System
==============================
17 AI-Agenten, 4 Tiers, 1 Mission.

Tier 0 (Brain):     STRATEGIST, DONNA
Tier 1 (C-Suite):   OPERATOR, ORACLE, ARCHITECT, TREASURER, PUBLISHER, COUNSEL
Tier 2 (Directors): AMPLIFIER, MERCHANT, RESEARCHER
Tier 3 (Operators): SCRIBE, TRADER, GUARDIAN, CONCIERGE, LOCALIZER

Architecture: BaseAgent + standalone Tools (kein CrewAI).
"""

from agents.config import LLM_COMPLEX, LLM_SIMPLE

# Core Architecture
from agents.base_agent import (
    AgentConfig,
    AgentMessage,
    AgentTier,
    BaseAgent,
    MessageBus,
    MessagePriority,
    MessageType,
)

# Tier 0 — Brain
from agents.strategist import StrategistAgent
from agents.donna import DonnaAgent

# Tier 1 — C-Suite
from agents.operator import OperatorAgent
from agents.oracle import OracleAgent
from agents.architect import ArchitectAgent
from agents.treasurer import TreasurerAgent
from agents.publisher import PublisherAgent
from agents.counsel import CounselAgent

# Tier 2 — Directors
from agents.amplifier import AmplifierAgent
from agents.merchant import MerchantAgent
from agents.researcher import ResearcherAgent

# Tier 3 — Operators
from agents.scribe import ScribeAgent
from agents.trader import TraderAgent
from agents.guardian import GuardianAgent
from agents.concierge import ConciergeAgent
from agents.localizer import LocalizerAgent

__all__ = [
    # Config
    "LLM_COMPLEX",
    "LLM_SIMPLE",
    # Core
    "AgentConfig",
    "AgentMessage",
    "AgentTier",
    "BaseAgent",
    "MessageBus",
    "MessagePriority",
    "MessageType",
    # Tier 0
    "StrategistAgent",
    "DonnaAgent",
    # Tier 1
    "OperatorAgent",
    "OracleAgent",
    "ArchitectAgent",
    "TreasurerAgent",
    "PublisherAgent",
    "CounselAgent",
    # Tier 2
    "AmplifierAgent",
    "MerchantAgent",
    "ResearcherAgent",
    # Tier 3
    "ScribeAgent",
    "TraderAgent",
    "GuardianAgent",
    "ConciergeAgent",
    "LocalizerAgent",
]
