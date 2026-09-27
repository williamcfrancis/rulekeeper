"""The bounded, portable campaign document shared by the game UI and DM."""

import json
import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .models import Evidence

ShortText = Annotated[str, Field(min_length=1, max_length=300)]
DieValue = Annotated[int, Field(strict=True, ge=1, le=100)]
Citation = Annotated[int, Field(strict=True, ge=1, le=6)]


class GameModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Character(GameModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=80)
    ancestry: str = Field(max_length=80)
    class_name: str = Field(max_length=80)
    level: int = Field(strict=True, ge=1, le=20)
    hp: int = Field(strict=True, ge=0, le=999)
    max_hp: int = Field(strict=True, ge=1, le=999)
    armor_class: int = Field(strict=True, ge=0, le=40)
    notes: str = Field(max_length=1500)

    @model_validator(mode="after")
    def valid_hit_points(self):
        if self.hp > self.max_hp:
            raise ValueError("Current hit points cannot exceed maximum hit points.")
        return self


def parse_dice(notation: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"([1-9][0-9]?)d(4|6|8|10|12|20|100)([+-][0-9]{1,3})?", notation)
    if not match:
        raise ValueError("Use dice notation such as 1d20+3 or 2d6.")
    count, sides = int(match[1]), int(match[2])
    modifier = int(match[3] or 0)
    if count > 20 or abs(modifier) > 100:
        raise ValueError("A roll supports at most 20 dice and a modifier from -100 to 100.")
    return count, sides, modifier


class RollRequest(GameModel):
    label: str = Field(min_length=1, max_length=120)
    notation: str = Field(min_length=3, max_length=40)
    mode: Literal["normal", "advantage", "disadvantage"] = "normal"
    reason: str = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def valid_dice(self):
        count, sides, _ = parse_dice(self.notation)
        if self.mode != "normal" and (count, sides) != (1, 20):
            raise ValueError("Advantage and disadvantage require a single d20.")
        return self


class RollResult(GameModel):
    request: RollRequest
    rolls: list[DieValue] = Field(min_length=1, max_length=20)
    kept: list[DieValue] = Field(min_length=1, max_length=20)
    modifier: int = Field(strict=True, ge=-100, le=100)
    total: int = Field(strict=True, ge=-99, le=2100)

    @model_validator(mode="after")
    def valid_arithmetic(self):
        count, sides, modifier = parse_dice(self.request.notation)
        expected_count = count if self.request.mode == "normal" else 2
        if len(self.rolls) != expected_count or any(die > sides for die in self.rolls):
            raise ValueError("The dice do not match the requested roll.")
        if self.request.mode == "advantage":
            expected_kept = [max(self.rolls)]
        elif self.request.mode == "disadvantage":
            expected_kept = [min(self.rolls)]
        else:
            expected_kept = self.rolls
        if self.kept != expected_kept:
            raise ValueError("The kept dice do not match the roll mode.")
        if self.modifier != modifier or self.total != sum(self.kept) + modifier:
            raise ValueError("The roll total does not match its dice and modifier.")
        return self


class JournalEntry(GameModel):
    role: Literal["player", "dm"]
    text: str = Field(min_length=1, max_length=6000)


class Campaign(GameModel):
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=100)
    premise: str = Field(min_length=1, max_length=3000)
    tone: str = Field(min_length=1, max_length=100)
    characters: list[Character] = Field(min_length=1, max_length=6)
    location: str = Field(max_length=200)
    summary: str = Field(max_length=4000)
    quests: list[ShortText] = Field(max_length=20)
    npcs: list[ShortText] = Field(max_length=20)
    inventory: list[ShortText] = Field(max_length=20)
    turn_count: int = Field(strict=True, ge=0, le=100_000)
    history: list[JournalEntry] = Field(max_length=200)
    pending_roll: RollRequest | None

    @model_validator(mode="after")
    def unique_characters(self):
        if len({character.id for character in self.characters}) != len(self.characters):
            raise ValueError("Every character must have a unique ID.")
        return self


class DMTurnRequest(GameModel):
    campaign: Campaign
    action: str = Field(min_length=1, max_length=2000)
    roll: RollResult | None = None

    @model_validator(mode="after")
    def bounded_document(self):
        size = len(json.dumps(self.model_dump(), ensure_ascii=False).encode("utf-8"))
        if size > 100_000:
            raise ValueError("The campaign document must be under 100 KB.")
        return self


class Ruling(GameModel):
    text: str = Field(min_length=1, max_length=1000)
    citations: list[Citation] = Field(max_length=6)


class DMTurnResponse(GameModel):
    campaign: Campaign
    narration: str
    rulings: list[Ruling]
    evidence: list[Evidence]
    roll: RollResult | None
    usage: dict
    model: str


class GeneratedTurn(GameModel):
    """Only these fields can be updated by the model, never campaign identity."""

    narration: str = Field(min_length=1, max_length=6000)
    location: str = Field(max_length=200)
    summary: str = Field(max_length=4000)
    quests: list[ShortText] = Field(max_length=20)
    npcs: list[ShortText] = Field(max_length=20)
    inventory: list[ShortText] = Field(max_length=20)
    characters: list[Character] = Field(min_length=1, max_length=6)
    pending_roll: RollRequest | None
    rulings: list[Ruling] = Field(max_length=6)
