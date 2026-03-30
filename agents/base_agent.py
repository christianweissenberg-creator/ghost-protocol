"""
Ghost Protocol — Base Agent Class
===================================
Das Fundament aller 17 Agenten. Jeder Agent erbt von BaseAgent
und bekommt automatisch: LLM-Zugriff, Message Bus, RAG, Logging, Health Checks.

Designed by ARCHITECT (CTO) nach dem Huang-Prinzip: Die Plattform IST das Produkt.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Optional

import anthropic
from supabase import create_client, Client


# ─────────────────────────────────────────────
# ENUMS & DATA CLASSES
# ─────────────────────────────────────────────

class AgentTier(Enum):
    """Agent hierarchy tiers."""
    BRAIN = 0       # CEO, DONNA
    C_SUITE = 1     # COO, CIO, CTO, CFO, CMO, CLO
    DIRECTOR = 2    # Growth, Product, Research
    OPERATOR = 3    # Content, Analyst, Support, QA, Localization


class MessagePriority(Enum):
    """Message priority levels for the Message Bus."""
    CRITICAL = "critical"   # Emergency, system failures
    HIGH = "high"           # Revenue opportunities, legal issues
    NORMAL = "normal"       # Standard communication
    LOW = "low"             # FYI, non-urgent updates


class MessageType(Enum):
    """Types of messages agents can send."""
    INTELLIGENCE_BRIEFING = "intelligence_briefing"
    TASK_REQUEST = "task_request"
    TASK_RESULT = "task_result"
    STATUS_UPDATE = "status_update"
    ALERT = "alert"
    DECISION_REQUEST = "decision_request"
    DECISION = "decision"
    LEGAL_REVIEW_REQUEST = "legal_review_request"
    LEGAL_REVIEW_RESULT = "legal_review_result"
    CONTENT_DRAFT = "content_draft"
    CONTENT_APPROVED = "content_approved"
    REVENUE_UPDATE = "revenue_update"
    HEALTH_CHECK = "health_check"
    CONFLICT_RESOLUTION = "conflict_resolution"


@dataclass
class AgentMessage:
    """Standard message format for agent-to-agent communication.

    Every message that flows through the Message Bus follows this schema.
    Designed for traceability, legal compliance, and real-time dashboard display.
    """
    id: str = field(default_factory=lambda: f"msg_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}")
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    from_agent: str = ""
    from_role: str = ""
    to_channels: list[str] = field(default_factory=list)
    to_agents: list[str] = field(default_factory=list)
    message_type: MessageType = MessageType.STATUS_UPDATE
    priority: MessagePriority = MessagePriority.NORMAL
    content: dict[str, Any] = field(default_factory=dict)
    requires_legal_review: bool = False
    confidence: float = 0.0
    parent_message_id: Optional[str] = None  # For threading
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dict for Supabase storage."""
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "from_agent": self.from_agent,
            "from_role": self.from_role,
            "to_channels": self.to_channels,
            "to_agents": self.to_agents,
            "message_type": self.message_type.value,
            "priority": self.priority.value,
            "content": json.dumps(self.content),
            "requires_legal_review": self.requires_legal_review,
            "confidence": self.confidence,
            "parent_message_id": self.parent_message_id,
            "metadata": json.dumps(self.metadata),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AgentMessage:
        """Deserialize from Supabase row."""
        return cls(
            id=data["id"],
            timestamp=data["timestamp"],
            from_agent=data["from_agent"],
            from_role=data["from_role"],
            to_channels=data.get("to_channels", []),
            to_agents=data.get("to_agents", []),
            message_type=MessageType(data["message_type"]),
            priority=MessagePriority(data["priority"]),
            content=json.loads(data["content"]) if isinstance(data["content"], str) else data["content"],
            requires_legal_review=data.get("requires_legal_review", False),
            confidence=data.get("confidence", 0.0),
            parent_message_id=data.get("parent_message_id"),
            metadata=json.loads(data["metadata"]) if isinstance(data.get("metadata", "{}"), str) else data.get("metadata", {}),
        )


@dataclass
class AgentConfig:
    """Configuration for an individual agent."""
    name: str
    role: str
    tier: AgentTier
    llm_model: str = "claude-sonnet-4-20250514"  # Default: Sonnet for complex tasks
    max_tokens: int = 4096
    temperature: float = 0.3
    channels: list[str] = field(default_factory=list)  # Channels this agent listens to
    tools: list[str] = field(default_factory=list)      # API tools available
    knowledge_tags: list[str] = field(default_factory=list)  # RAG knowledge categories


# ─────────────────────────────────────────────
# STRUCTURED LOGGING
# ─────────────────────────────────────────────

class AgentLogger:
    """JSON-structured logger for agent activities.

    Every log entry includes agent_id and timestamp for dashboard integration.
    Logs go to both file and Supabase for real-time monitoring.
    """

    def __init__(self, agent_name: str, log_dir: str = "logs"):
        self.agent_name = agent_name
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(exist_ok=True)

        self.logger = logging.getLogger(f"ghost.{agent_name}")
        self.logger.setLevel(logging.DEBUG)

        # File handler
        handler = logging.FileHandler(self.log_dir / f"{agent_name}.log")
        handler.setFormatter(logging.Formatter("%(message)s"))
        self.logger.addHandler(handler)

    def log(self, level: str, action: str, details: dict[str, Any] | None = None) -> None:
        """Log a structured event."""
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "agent": self.agent_name,
            "level": level,
            "action": action,
            "details": details or {},
        }
        log_line = json.dumps(entry)
        if level == "error":
            self.logger.error(log_line)
        elif level == "warning":
            self.logger.warning(log_line)
        else:
            self.logger.info(log_line)

    def info(self, action: str, details: dict[str, Any] | None = None) -> None:
        self.log("info", action, details)

    def error(self, action: str, details: dict[str, Any] | None = None) -> None:
        self.log("error", action, details)

    def warning(self, action: str, details: dict[str, Any] | None = None) -> None:
        self.log("warning", action, details)


# ─────────────────────────────────────────────
# RAG — KNOWLEDGE RETRIEVAL
# ─────────────────────────────────────────────

class KnowledgeRetriever:
    """RAG interface for agent knowledge bases.

    Uses Supabase pgvector for semantic search across curated documents.
    Each agent has tagged knowledge categories — retrieval is scoped to relevant docs.
    """

    def __init__(self, supabase: Client, agent_tags: list[str]):
        self.supabase = supabase
        self.agent_tags = agent_tags

    async def retrieve(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        """Retrieve relevant knowledge chunks for a query.

        Args:
            query: The search query (will be embedded)
            top_k: Number of chunks to retrieve

        Returns:
            List of relevant document chunks with metadata
        """
        try:
            # Use Supabase RPC for vector similarity search
            result = self.supabase.rpc(
                "match_knowledge",
                {
                    "query_text": query,
                    "match_count": top_k,
                    "filter_tags": self.agent_tags,
                }
            ).execute()
            return result.data if result.data else []
        except Exception as e:
            # Graceful fallback — agent works without RAG, just less informed
            logging.warning(f"RAG retrieval failed: {e}")
            return []

    def format_context(self, chunks: list[dict[str, Any]]) -> str:
        """Format retrieved chunks into context string for LLM."""
        if not chunks:
            return ""

        context_parts = ["## Relevant Knowledge from Ghost Protocol Knowledge Base\n"]
        for i, chunk in enumerate(chunks, 1):
            source = chunk.get("source", "unknown")
            text = chunk.get("content", "")
            score = chunk.get("similarity", 0)
            context_parts.append(
                f"### Source {i}: {source} (relevance: {score:.2f})\n{text}\n"
            )
        return "\n".join(context_parts)


# ─────────────────────────────────────────────
# MESSAGE BUS
# ─────────────────────────────────────────────

class MessageBus:
    """Agent-to-Agent communication via Supabase Realtime.

    Implements the channel-based communication system:
    - #boardroom, #market-intel, #content, #legal-review, #ops, #revenue, #growth, #emergency
    - Direct messages via @agent mentions
    - Priority-based message queuing

    All messages are persisted in Supabase for dashboard display and audit trail.
    """

    def __init__(self, supabase: Client, agent_name: str):
        self.supabase = supabase
        self.agent_name = agent_name
        self._handlers: dict[str, list] = {}  # channel -> handler functions

    async def send(self, message: AgentMessage) -> None:
        """Send a message to the Message Bus.

        Message is stored in Supabase and broadcast via Realtime to subscribers.
        """
        try:
            self.supabase.table("messages").insert(message.to_dict()).execute()
        except Exception as e:
            logging.error(f"Failed to send message: {e}")

    async def listen(self, channels: list[str]) -> None:
        """Subscribe to channels and process incoming messages.

        Uses Supabase Realtime for WebSocket-based message delivery.
        Falls back to polling if Realtime is unavailable.
        """
        # Supabase Realtime subscription
        # NOTE: In production, this uses supabase-py realtime client
        # For MVP, we use polling with 5-second intervals
        while True:
            try:
                for channel in channels:
                    result = self.supabase.table("messages") \
                        .select("*") \
                        .contains("to_channels", [channel]) \
                        .order("timestamp", desc=True) \
                        .limit(10) \
                        .execute()

                    for msg_data in (result.data or []):
                        message = AgentMessage.from_dict(msg_data)
                        await self._dispatch(channel, message)

                # Also check direct messages
                result = self.supabase.table("messages") \
                    .select("*") \
                    .contains("to_agents", [self.agent_name]) \
                    .order("timestamp", desc=True) \
                    .limit(10) \
                    .execute()

                for msg_data in (result.data or []):
                    message = AgentMessage.from_dict(msg_data)
                    await self._dispatch("direct", message)

            except Exception as e:
                logging.error(f"Message Bus listen error: {e}")

            await asyncio.sleep(5)  # Polling interval

    def on_message(self, channel: str, handler) -> None:
        """Register a handler for messages on a channel."""
        if channel not in self._handlers:
            self._handlers[channel] = []
        self._handlers[channel].append(handler)

    async def _dispatch(self, channel: str, message: AgentMessage) -> None:
        """Dispatch message to registered handlers."""
        handlers = self._handlers.get(channel, [])
        for handler in handlers:
            try:
                await handler(message)
            except Exception as e:
                logging.error(f"Handler error on {channel}: {e}")


# ─────────────────────────────────────────────
# BASE AGENT
# ─────────────────────────────────────────────

class BaseAgent(ABC):
    """Base class for all Ghost Protocol agents.

    Every agent in the system inherits from this class and gets:
    - LLM access (Claude Sonnet/Haiku via Anthropic API)
    - Message Bus connection (send/receive messages to other agents)
    - RAG Knowledge Retrieval (curated knowledge per agent role)
    - Structured Logging (JSON, dashboard-compatible)
    - Health Check reporting
    - Cost tracking per API call

    Usage:
        class OracleAgent(BaseAgent):
            async def execute(self, task: str) -> dict:
                # Oracle-specific logic
                knowledge = await self.retrieve_knowledge(task)
                response = await self.think(task, context=knowledge)
                await self.broadcast("#market-intel", response)
                return response
    """

    def __init__(self, config: AgentConfig):
        self.config = config
        self.name = config.name
        self.role = config.role
        self.tier = config.tier

        # Initialize Anthropic client
        self.client = anthropic.Anthropic(
            api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
        )

        # Initialize Supabase client
        supabase_url = os.environ.get("SUPABASE_URL", "")
        supabase_key = os.environ.get("SUPABASE_KEY", "")
        self.supabase: Client | None = None
        if supabase_url and supabase_key:
            self.supabase = create_client(supabase_url, supabase_key)

        # Initialize components
        self.logger = AgentLogger(self.name)
        self.knowledge = KnowledgeRetriever(self.supabase, config.knowledge_tags) if self.supabase else None
        self.message_bus = MessageBus(self.supabase, self.name) if self.supabase else None

        # Cost tracking
        self._total_input_tokens = 0
        self._total_output_tokens = 0
        self._total_cost_usd = 0.0

        # System prompt (loaded from file or set directly)
        self._system_prompt: str = ""

        self.logger.info("agent_initialized", {
            "name": self.name,
            "role": self.role,
            "tier": self.tier.name,
            "model": self.config.llm_model,
        })

    # ── System Prompt ──────────────────────────

    def load_system_prompt(self, prompt_path: str | None = None) -> str:
        """Load the agent's system prompt from file.

        Looks for prompts in: agents/prompts/{agent_name}.md
        """
        if prompt_path:
            path = Path(prompt_path)
        else:
            path = Path(__file__).parent / "prompts" / f"{self.name}.md"

        if path.exists():
            self._system_prompt = path.read_text(encoding="utf-8")
            self.logger.info("system_prompt_loaded", {"path": str(path), "chars": len(self._system_prompt)})
        else:
            self.logger.warning("system_prompt_not_found", {"path": str(path)})
            self._system_prompt = f"You are {self.name}, the {self.role} of Ghost Protocol."

        return self._system_prompt

    @property
    def system_prompt(self) -> str:
        if not self._system_prompt:
            self.load_system_prompt()
        return self._system_prompt

    # ── LLM Interaction ────────────────────────

    async def think(
        self,
        task: str,
        context: str = "",
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> str:
        """Core LLM call — the agent 'thinks' about a task.

        Automatically:
        - Includes system prompt
        - Injects RAG context if available
        - Tracks token usage and costs
        - Logs the interaction

        Args:
            task: The task/question to think about
            context: Additional context (e.g., from RAG or other agents)
            max_tokens: Override default max tokens
            temperature: Override default temperature

        Returns:
            The agent's response as a string
        """
        start_time = time.time()

        # Build message with optional RAG context
        user_message = task
        if context:
            user_message = f"{context}\n\n---\n\n## Current Task\n{task}"

        try:
            response = self.client.messages.create(
                model=self.config.llm_model,
                max_tokens=max_tokens or self.config.max_tokens,
                temperature=temperature or self.config.temperature,
                system=self.system_prompt,
                messages=[{"role": "user", "content": user_message}],
            )

            # Track costs
            input_tokens = response.usage.input_tokens
            output_tokens = response.usage.output_tokens
            self._track_cost(input_tokens, output_tokens)

            result = response.content[0].text
            elapsed = time.time() - start_time

            self.logger.info("llm_call", {
                "model": self.config.llm_model,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": self._calculate_cost(input_tokens, output_tokens),
                "elapsed_seconds": round(elapsed, 2),
                "task_preview": task[:100],
            })

            return result

        except anthropic.RateLimitError:
            self.logger.error("rate_limit_hit", {"model": self.config.llm_model})
            await asyncio.sleep(30)  # Exponential backoff
            return await self.think(task, context, max_tokens, temperature)

        except Exception as e:
            self.logger.error("llm_call_failed", {"error": str(e)})
            raise

    # ── RAG Knowledge Retrieval ────────────────

    async def retrieve_knowledge(self, query: str, top_k: int = 5) -> str:
        """Retrieve relevant knowledge from the agent's knowledge base.

        Uses semantic search on Supabase pgvector to find relevant
        document chunks tagged for this agent's domain.

        Args:
            query: What to search for
            top_k: Number of chunks to retrieve

        Returns:
            Formatted context string ready for injection into LLM prompt
        """
        if not self.knowledge:
            return ""

        chunks = await self.knowledge.retrieve(query, top_k)
        return self.knowledge.format_context(chunks)

    # ── Message Bus ────────────────────────────

    async def send_message(
        self,
        channels: list[str],
        content: dict[str, Any],
        message_type: MessageType = MessageType.STATUS_UPDATE,
        priority: MessagePriority = MessagePriority.NORMAL,
        to_agents: list[str] | None = None,
        requires_legal_review: bool = False,
        confidence: float = 0.0,
        parent_id: str | None = None,
    ) -> AgentMessage:
        """Send a message to the Message Bus.

        Args:
            channels: Channels to send to (e.g., ["#market-intel", "#boardroom"])
            content: Message content as dict
            message_type: Type of message
            priority: Priority level
            to_agents: Direct mentions (e.g., ["publisher", "scribe"])
            requires_legal_review: Flag for COUNSEL review
            confidence: Confidence level (0.0-1.0)
            parent_id: Parent message ID for threading

        Returns:
            The sent AgentMessage
        """
        message = AgentMessage(
            from_agent=self.name,
            from_role=self.role,
            to_channels=channels,
            to_agents=to_agents or [],
            message_type=message_type,
            priority=priority,
            content=content,
            requires_legal_review=requires_legal_review,
            confidence=confidence,
            parent_message_id=parent_id,
        )

        if self.message_bus:
            await self.message_bus.send(message)

        self.logger.info("message_sent", {
            "id": message.id,
            "channels": channels,
            "type": message_type.value,
            "priority": priority.value,
        })

        return message

    async def broadcast(self, channel: str, content: dict[str, Any], **kwargs) -> AgentMessage:
        """Shortcut to send a message to a single channel."""
        return await self.send_message([channel], content, **kwargs)

    # ── Health Check ───────────────────────────

    async def health_check(self) -> dict[str, Any]:
        """Report agent health status.

        Called by GUARDIAN every 60 seconds. Reports:
        - Online status
        - Token usage and costs
        - Last activity timestamp
        - Error count
        """
        status = {
            "agent": self.name,
            "role": self.role,
            "status": "online",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "total_input_tokens": self._total_input_tokens,
            "total_output_tokens": self._total_output_tokens,
            "total_cost_usd": round(self._total_cost_usd, 4),
            "model": self.config.llm_model,
        }

        if self.message_bus:
            await self.broadcast(
                "#ops",
                status,
                message_type=MessageType.HEALTH_CHECK,
                priority=MessagePriority.LOW,
            )

        return status

    # ── Cost Tracking ──────────────────────────

    def _calculate_cost(self, input_tokens: int, output_tokens: int) -> float:
        """Calculate cost in USD for a single API call.

        Pricing (as of 2026):
        - Sonnet: $3/M input, $15/M output
        - Haiku: $0.25/M input, $1.25/M output
        """
        if "haiku" in self.config.llm_model:
            input_cost = input_tokens * 0.25 / 1_000_000
            output_cost = output_tokens * 1.25 / 1_000_000
        else:  # Sonnet
            input_cost = input_tokens * 3.0 / 1_000_000
            output_cost = output_tokens * 15.0 / 1_000_000
        return input_cost + output_cost

    def _track_cost(self, input_tokens: int, output_tokens: int) -> None:
        """Track cumulative token usage and costs."""
        self._total_input_tokens += input_tokens
        self._total_output_tokens += output_tokens
        self._total_cost_usd += self._calculate_cost(input_tokens, output_tokens)

    @property
    def cost_summary(self) -> dict[str, Any]:
        """Get current cost summary."""
        return {
            "total_input_tokens": self._total_input_tokens,
            "total_output_tokens": self._total_output_tokens,
            "total_cost_usd": round(self._total_cost_usd, 4),
            "model": self.config.llm_model,
        }

    # ── Abstract Methods ───────────────────────

    @abstractmethod
    async def execute(self, task: str, **kwargs) -> dict[str, Any]:
        """Execute the agent's primary function.

        Every agent must implement this method with their specific logic.

        Args:
            task: The task to execute
            **kwargs: Additional task-specific parameters

        Returns:
            Result dict with at minimum: {"status": "success/error", "output": ...}
        """
        ...

    # ── Utility ────────────────────────────────

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} name={self.name} role={self.role} tier={self.tier.name}>"
