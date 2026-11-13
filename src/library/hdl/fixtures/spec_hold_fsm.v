// A hold check on a state machine that moves on at the edge (feat/hdl-timing): `q` loads `d` on
// every other edge (`en` toggles), so after an edge that loaded, the next edge wouldn't — a late
// `d` must spoil what that edge loaded, not what the next one would.
module spec_hold_fsm (
    input      clk,
    input      rst,
    input      d,
    output reg q,
    output reg en
);
  always @(posedge clk)
    if (rst) begin
      en <= 1'b1;
      q  <= 1'b0;
    end else begin
      en <= !en;
      if (en) q <= d;
    end
  specify
    (posedge clk *> (q +: d)) = 5;
    (posedge clk *> (en +: d)) = 5;
    $hold(posedge clk, d, 3);
  endspecify
endmodule
